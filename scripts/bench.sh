#!/usr/bin/env bash
# Benchmark latency: 100 requests to the gateway, report P50/P95/P99
set -euo pipefail

URL="${1:-http://localhost:8080/healthz}"
N=100

echo "Target: $URL"
echo "Requests: $N"
echo ""

latencies=()

for i in $(seq 1 $N); do
    ms=$(curl -sS -o /dev/null -w '%{time_total}' "$URL" 2>/dev/null)
    # Convert seconds to milliseconds
    ms_int=$(echo "$ms * 1000" | bc 2>/dev/null || python3 -c "print(round($ms * 1000, 2))")
    latencies+=("$ms_int")
    printf "\r  Progress: %d/%d" "$i" "$N"
done

echo ""
echo ""

# Sort latencies and compute percentiles
sorted=($(printf '%s\n' "${latencies[@]}" | sort -n))
count=${#sorted[@]}

p50_idx=$(( count * 50 / 100 ))
p95_idx=$(( count * 95 / 100 ))
p99_idx=$(( count * 99 / 100 ))

# Compute average
total=0
for lat in "${latencies[@]}"; do
    total=$(echo "$total + $lat" | bc 2>/dev/null || python3 -c "print($total + $lat)")
done
avg=$(echo "scale=2; $total / $count" | bc 2>/dev/null || python3 -c "print(round($total / $count, 2))")

echo "Results:"
echo "  Avg:  ${avg} ms"
echo "  P50:  ${sorted[$p50_idx]} ms"
echo "  P95:  ${sorted[$p95_idx]} ms"
echo "  P99:  ${sorted[$p99_idx]} ms"
echo "  Min:  ${sorted[0]} ms"
echo "  Max:  ${sorted[$((count - 1))]} ms"
