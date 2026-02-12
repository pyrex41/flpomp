# Agent Team - Docker Container
# Each agent runs in isolation for safe --dangerously-skip-permissions

FROM ubuntu:22.04

# Avoid interactive prompts
ENV DEBIAN_FRONTEND=noninteractive

# Base tools
RUN apt-get update && apt-get install -y \
    git \
    curl \
    wget \
    build-essential \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js (for Claude Code CLI)
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

# ============================================================================
# CUSTOMIZE: Add your project's dependencies below
# ============================================================================

# Example: Python
# RUN apt-get update && apt-get install -y python3 python3-pip
# COPY requirements.txt /tmp/
# RUN pip3 install -r /tmp/requirements.txt

# Example: Rust
# RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
# ENV PATH="/root/.cargo/bin:${PATH}"

# Example: Go
# RUN wget https://go.dev/dl/go1.21.0.linux-amd64.tar.gz \
#     && tar -C /usr/local -xzf go1.21.0.linux-amd64.tar.gz \
#     && rm go1.21.0.linux-amd64.tar.gz
# ENV PATH="/usr/local/go/bin:${PATH}"

# ============================================================================
# END CUSTOMIZATION
# ============================================================================

# Git configuration for automated commits
RUN git config --global user.email "agent@localhost" \
    && git config --global user.name "Agent"

WORKDIR /workspace

# Default command
CMD ["./agent_loop.sh"]
