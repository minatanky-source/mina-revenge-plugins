#!/usr/bin/env bash
# Shared helpers for pool workflows.

# Branch holding the pool and the index. Set the POOL_BRANCH repository variable to move it.
POOL_BRANCH="${POOL_BRANCH:-gh-pages}"
# Working copy of that branch.
POOL_CHECKOUT="${POOL_CHECKOUT:-published}"

# Prints the URL the pool is served from without a trailing slash.
pages_base_url() {
    if [ -n "${PAGES_BASE_URL:-}" ]; then
        printf '%s' "${PAGES_BASE_URL%/}"
        return
    fi

    printf 'https://raw.githubusercontent.com/%s/%s' "$GITHUB_REPOSITORY" "$POOL_BRANCH"
}

# Commits staged pool changes and pushes them. Skips if nothing is staged.
commit_pool() {
    if git -C "$POOL_CHECKOUT" diff --cached --quiet; then
        echo "$1"
        return 0
    fi

    git -C "$POOL_CHECKOUT" commit -m "$2"
    git -C "$POOL_CHECKOUT" push origin "$POOL_BRANCH"
}
