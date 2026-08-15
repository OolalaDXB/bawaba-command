// demo-backend is a REAL upstream MCP server: a minimal invoice/payment
// ledger the gateway forwards allowed tool calls to. It is intentionally
// tiny, but it is a genuine separate process with genuine state — when the
// gateway says ALLOW, a payment record really lands here; when it says
// DENY, this process never hears about the call. That asymmetry IS the
// enforcement demo. No customer data: the ledger is seeded with fictional
// invoices and resets on restart.
package main

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"sync"
	"time"
)

type invoice struct {
	InvoiceID string  `json:"invoice_id"`
	Supplier  string  `json:"supplier"`
	Amount    float64 `json:"amount"`
	Currency  string  `json:"currency"`
	Status    string  `json:"status"` // open | paid
}

type payment struct {
	PaymentID string    `json:"payment_id"`
	InvoiceID string    `json:"invoice_id,omitempty"`
	Amount    float64   `json:"amount"`
	Currency  string    `json:"currency"`
	At        time.Time `json:"at"`
}

type ledger struct {
	mu       sync.Mutex
	invoices map[string]*invoice
	payments []payment
}

func newLedger() *ledger {
	return &ledger{invoices: map[string]*invoice{
		"INV-2041": {InvoiceID: "INV-2041", Supplier: "Atlas Office Supplies (fictional)", Amount: 12500, Currency: "EUR", Status: "open"},
		"INV-7":    {InvoiceID: "INV-7", Supplier: "Gulf Cloud Services (fictional)", Amount: 100, Currency: "EUR", Status: "open"},
		"INV-9001": {InvoiceID: "INV-9001", Supplier: "Oasis Facilities (fictional)", Amount: 9000, Currency: "EUR", Status: "open"},
	}}
}

type rpcRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      interface{}     `json:"id"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params"`
}

func writeRPC(w http.ResponseWriter, id, result interface{}, errMsg string) {
	w.Header().Set("Content-Type", "application/json")
	resp := map[string]interface{}{"jsonrpc": "2.0", "id": id}
	if errMsg != "" {
		resp["error"] = map[string]interface{}{"code": -32000, "message": errMsg}
	} else {
		resp["result"] = result
	}
	json.NewEncoder(w).Encode(resp)
}

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	led := newLedger()

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"status":"ok","service":"demo-backend"}`))
	})

	// The whole point of a control plane: this state is only reachable
	// THROUGH the gateway for agents — and directly for auditors, so anyone
	// can verify what really happened here.
	mux.HandleFunc("GET /ledger", func(w http.ResponseWriter, r *http.Request) {
		led.mu.Lock()
		defer led.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		json.NewEncoder(w).Encode(map[string]interface{}{"invoices": led.invoices, "payments": led.payments})
	})

	mux.HandleFunc("POST /mcp", func(w http.ResponseWriter, r *http.Request) {
		var req rpcRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Method != "tools/call" {
			writeRPC(w, nil, nil, "expected JSON-RPC tools/call")
			return
		}
		var params struct {
			Name      string          `json:"name"`
			Arguments json.RawMessage `json:"arguments"`
		}
		_ = json.Unmarshal(req.Params, &params)

		led.mu.Lock()
		defer led.mu.Unlock()
		switch params.Name {
		case "read_invoice":
			var args struct {
				InvoiceID string `json:"invoice_id"`
			}
			_ = json.Unmarshal(params.Arguments, &args)
			if args.InvoiceID == "" {
				// No id → list open invoices (real data, fictional suppliers).
				open := []*invoice{}
				for _, inv := range led.invoices {
					open = append(open, inv)
				}
				writeRPC(w, req.ID, map[string]interface{}{"invoices": open}, "")
				return
			}
			inv, ok := led.invoices[args.InvoiceID]
			if !ok {
				writeRPC(w, req.ID, nil, fmt.Sprintf("invoice %q not found", args.InvoiceID))
				return
			}
			writeRPC(w, req.ID, inv, "")
		case "execute_payment":
			var args struct {
				InvoiceID string  `json:"invoice_id"`
				Amount    float64 `json:"amount"`
				Currency  string  `json:"currency"`
			}
			_ = json.Unmarshal(params.Arguments, &args)
			if args.Amount <= 0 {
				writeRPC(w, req.ID, nil, "amount must be positive")
				return
			}
			p := payment{
				PaymentID: fmt.Sprintf("PAY-%d", time.Now().UnixNano()%1_000_000),
				InvoiceID: args.InvoiceID,
				Amount:    args.Amount,
				Currency:  args.Currency,
				At:        time.Now().UTC(),
			}
			led.payments = append(led.payments, p)
			if inv, ok := led.invoices[args.InvoiceID]; ok {
				inv.Status = "paid"
			}
			logger.Info("payment executed", "payment_id", p.PaymentID, "amount", p.Amount, "currency", p.Currency)
			writeRPC(w, req.ID, map[string]interface{}{"payment": p, "ledger_size": len(led.payments)}, "")
		default:
			writeRPC(w, req.ID, nil, fmt.Sprintf("tool %q not served by demo-backend", params.Name))
		}
	})

	port := os.Getenv("BACKEND_PORT")
	if port == "" {
		port = "9090"
	}
	logger.Info("demo-backend (real upstream ledger) listening", "port", port)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		logger.Error("server error", "error", err)
		os.Exit(1)
	}
}
