package tokenizer

/*
#cgo LDFLAGS: -L${SRCDIR}/../../rust/tokenizer/target/release -lbawaba_tokenizer -lm -ldl -lpthread
#include <stdlib.h>

typedef struct {
    char* output;
    unsigned int entities_count;
    unsigned int tokens_generated;
    unsigned long long processing_us;
} CTokenizationResult;

extern void bawaba_vault_init(unsigned long long ttl_secs);
extern CTokenizationResult bawaba_tokenize(const char* input, const char* scope);
extern char* bawaba_detokenize(const char* input, const char* scope);
extern void bawaba_vault_purge();
extern void bawaba_free_string(char* s);
*/
import "C"
import (
	"unsafe"
)

// TokenizationResult is the Go equivalent of the Rust CTokenizationResult.
type TokenizationResult struct {
	Output          string
	EntitiesCount   int
	TokensGenerated int
	ProcessingUS    uint64
}

// InitVault initializes the Rust token vault with a TTL in seconds.
func InitVault(ttlSecs uint64) {
	C.bawaba_vault_init(C.ulonglong(ttlSecs))
}

// Tokenize replaces PII in the input text with UUID tokens.
// scope is "tenant_id:session_id" for vault scoping.
func Tokenize(input, scope string) TokenizationResult {
	cInput := C.CString(input)
	defer C.free(unsafe.Pointer(cInput))
	cScope := C.CString(scope)
	defer C.free(unsafe.Pointer(cScope))

	result := C.bawaba_tokenize(cInput, cScope)
	defer C.bawaba_free_string(result.output)

	return TokenizationResult{
		Output:          C.GoString(result.output),
		EntitiesCount:   int(result.entities_count),
		TokensGenerated: int(result.tokens_generated),
		ProcessingUS:    uint64(result.processing_us),
	}
}

// Detokenize replaces UUID tokens in the input text with original PII values.
func Detokenize(input, scope string) string {
	cInput := C.CString(input)
	defer C.free(unsafe.Pointer(cInput))
	cScope := C.CString(scope)
	defer C.free(unsafe.Pointer(cScope))

	result := C.bawaba_detokenize(cInput, cScope)
	defer C.bawaba_free_string(result)

	return C.GoString(result)
}

// PurgeExpired removes expired tokens from the vault.
func PurgeExpired() {
	C.bawaba_vault_purge()
}
