#!/bin/bash
# Test Harness Wrapper
# Produces consistent, agent-friendly output
#
# Key features:
# - Normalized output (ERROR/PASS/SUMMARY)
# - Fast mode with probabilistic sampling
# - Timeout protection
# - Agent-parseable format

set -e

# Configuration
FAST_MODE="${FAST_MODE:-false}"
SAMPLE_RATE="${SAMPLE_RATE:-10}"      # Percent of tests in fast mode
TIMEOUT="${TIMEOUT:-300}"              # Max seconds per test
AGENT_ID="${AGENT_ID:-$$}"            # For deterministic sampling

# Colors (for human readability, agents parse the text)
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Counters
PASSED=0
FAILED=0
SKIPPED=0

# ============================================================================
# CUSTOMIZE THIS SECTION FOR YOUR PROJECT
# ============================================================================

# List all available tests (one per line)
list_tests() {
    # Example: find all test files
    # find tests/ -name "test_*.py" -type f
    # Or: list test functions
    # grep -r "^def test_" tests/ | cut -d: -f2 | sed 's/def //' | sed 's/(.*$//'

    echo "TODO: Implement list_tests for your project"
}

# Run a single test by name
# Args: $1 = test name
# Should exit 0 on pass, non-zero on fail
run_single_test() {
    local test_name="$1"

    # Example: pytest
    # timeout "$TIMEOUT" pytest "$test_name" -v

    # Example: cargo test
    # timeout "$TIMEOUT" cargo test "$test_name" -- --nocapture

    # Example: go test
    # timeout "$TIMEOUT" go test -run "$test_name" -v ./...

    echo "TODO: Implement run_single_test for your project"
    return 1
}

# Run all tests at once (used when not in fast mode)
# Should output test results to stdout
run_all_tests() {
    # Example: pytest
    # pytest -v

    # Example: cargo test
    # cargo test -- --nocapture

    # Example: go test
    # go test -v ./...

    echo "TODO: Implement run_all_tests for your project"
}

# ============================================================================
# END CUSTOMIZATION SECTION
# ============================================================================

# Normalize a line of output for agent parsing
normalize_output() {
    while IFS= read -r line; do
        # Detect errors/failures
        if echo "$line" | grep -qiE "(error|fail|fatal|panic|exception|traceback)"; then
            echo "ERROR: $line"
            ((FAILED++)) || true
        # Detect passes
        elif echo "$line" | grep -qiE "(pass|ok|success|\\.\\.\\..*ok)"; then
            echo "PASS: $line"
            ((PASSED++)) || true
        # Detect skips
        elif echo "$line" | grep -qiE "(skip|ignore|pending)"; then
            echo "SKIP: $line"
            ((SKIPPED++)) || true
        # Pass through other lines
        else
            echo "$line"
        fi
    done
}

# Deterministic random sampling based on agent ID
should_run_test() {
    local test_name="$1"
    # Hash test name + agent ID for deterministic but varied selection
    local hash=$(echo "${test_name}${AGENT_ID}" | md5sum | cut -c1-8)
    local num=$((16#$hash % 100))
    [ $num -lt $SAMPLE_RATE ]
}

# Main execution
main() {
    echo "============================================"
    echo "Test Harness - $(date)"
    echo "Agent: $AGENT_ID"
    echo "Fast mode: $FAST_MODE"
    [ "$FAST_MODE" = "true" ] && echo "Sample rate: $SAMPLE_RATE%"
    echo "============================================"
    echo ""

    if [ "$FAST_MODE" = "true" ]; then
        # Run sampled subset of tests
        echo "Running sampled tests..."
        echo ""

        while IFS= read -r test; do
            [ -z "$test" ] && continue

            if should_run_test "$test"; then
                echo ">>> Running: $test"
                if run_single_test "$test" 2>&1 | normalize_output; then
                    echo -e "${GREEN}PASS${NC}: $test"
                    ((PASSED++)) || true
                else
                    echo -e "${RED}FAIL${NC}: $test"
                    ((FAILED++)) || true
                fi
                echo ""
            else
                ((SKIPPED++)) || true
            fi
        done < <(list_tests)
    else
        # Run all tests
        echo "Running all tests..."
        echo ""
        run_all_tests 2>&1 | normalize_output
    fi

    # Summary
    echo ""
    echo "============================================"
    echo "SUMMARY: $PASSED passed, $FAILED failed, $SKIPPED skipped"
    echo "============================================"

    # Exit with failure if any tests failed
    [ $FAILED -eq 0 ]
}

# Handle specific test argument
if [ -n "$1" ]; then
    echo "Running specific test: $1"
    run_single_test "$1" 2>&1 | normalize_output
    exit $?
fi

main
