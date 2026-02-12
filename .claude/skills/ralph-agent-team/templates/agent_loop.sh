#!/bin/bash
# Agent Team - Autonomous Loop
# Run one instance per agent, each in isolated environment
#
# Usage:
#   Single agent:  ./agent_loop.sh
#   Multiple:      for i in {1..4}; do AGENT_ID="agent-$i" ./agent_loop.sh & done
#   With Docker:   See docker-compose.yml

set -e

# Configuration
AGENT_ID="${AGENT_ID:-$(hostname)-$$}"
UPSTREAM="${UPSTREAM:-origin}"
BRANCH="${BRANCH:-main}"
LOG_DIR="${LOG_DIR:-agent_logs}"
PROMPT_FILE="${PROMPT_FILE:-AGENT_PROMPT.md}"
MODEL="${MODEL:-claude-sonnet-4-5-20250929}"
MAX_ITERATIONS="${MAX_ITERATIONS:-1000}"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

mkdir -p "$LOG_DIR"
mkdir -p "current_tasks"

echo -e "${GREEN}Agent $AGENT_ID starting...${NC}"
echo "  Upstream: $UPSTREAM/$BRANCH"
echo "  Model: $MODEL"
echo "  Max iterations: $MAX_ITERATIONS"
echo ""

iteration=0

while [ $iteration -lt $MAX_ITERATIONS ]; do
    iteration=$((iteration + 1))
    COMMIT=$(git rev-parse --short=6 HEAD)
    TIMESTAMP=$(date +%Y%m%d_%H%M%S)
    LOGFILE="$LOG_DIR/agent_${AGENT_ID}_${TIMESTAMP}_${COMMIT}.log"

    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}  Agent: $AGENT_ID | Iteration: $iteration${NC}"
    echo -e "${GREEN}  $(date '+%Y-%m-%d %H:%M:%S') | Commit: $COMMIT${NC}"
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

    # Sync with upstream (merge others' changes)
    echo "Syncing with upstream..."
    git fetch "$UPSTREAM" 2>/dev/null || true
    git merge "$UPSTREAM/$BRANCH" --no-edit 2>/dev/null || {
        echo -e "${YELLOW}Merge conflict - aborting and retrying...${NC}"
        git merge --abort 2>/dev/null || true
        sleep $((RANDOM % 10 + 5))
        continue
    }

    # Check if prompt file exists
    if [[ ! -f "$PROMPT_FILE" ]]; then
        echo -e "${RED}Error: Prompt file not found: $PROMPT_FILE${NC}"
        exit 1
    fi

    # Run agent
    echo "Running Claude..."
    if claude --dangerously-skip-permissions \
              -p "$(cat "$PROMPT_FILE")" \
              --model "$MODEL" \
              &> "$LOGFILE"; then
        echo -e "${GREEN}Agent completed successfully${NC}"
    else
        echo -e "${YELLOW}Agent exited with error (see log)${NC}"
    fi

    # Try to push changes
    if [ -n "$(git status --porcelain)" ]; then
        echo "Pushing changes..."
        git push "$UPSTREAM" "$BRANCH" 2>/dev/null || {
            echo -e "${YELLOW}Push failed - will retry after merge${NC}"
        }
    fi

    echo "Log saved: $LOGFILE"
    echo ""

    # Brief pause before next iteration
    sleep 5
done

echo -e "${YELLOW}Reached max iterations ($MAX_ITERATIONS)${NC}"
