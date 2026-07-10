# Dependabot Trial Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Configure Dependabot for Devvit MCP's npm dependencies and GitHub
Actions, delaying ordinary version updates for seven days while retaining
immediate, identifiable security updates.

**Architecture:** A single repository-local `.github/dependabot.yml` defines
one update block for each detected ecosystem. Each block contains the same
weekly Pacific-time schedule, a seven-day version-update cooldown, and a
security-only group whose identifier appears in Dependabot's grouped pull
request title and branch.

**Tech Stack:** Dependabot configuration v2, YAML, Ruby's built-in `yaml`
parser for local structural validation.

---

### Task 1: Add the Dependabot policy and validate its contract

**Files:**
- Create: `.github/dependabot.yml`
- Test: inline Ruby YAML contract run from the repository root

- [ ] **Step 1: Run the configuration contract before the file exists**

Run:

```bash
ruby -e 'require "yaml"; config = YAML.load_file(".github/dependabot.yml"); expected = { "npm" => "security-vulnerabilities-npm", "github-actions" => "security-vulnerabilities-github-actions" }; abort "expected version 2" unless config["version"] == 2; expected.each { |ecosystem, group| update = config.fetch("updates").find { |entry| entry["package-ecosystem"] == ecosystem }; abort "missing #{ecosystem}" unless update; abort "wrong directory for #{ecosystem}" unless update["directory"] == "/"; schedule = update.fetch("schedule"); abort "wrong schedule for #{ecosystem}" unless schedule == { "interval" => "weekly", "day" => "monday", "time" => "11:00", "timezone" => "America/Los_Angeles" }; abort "wrong cooldown for #{ecosystem}" unless update.fetch("cooldown") == { "default-days" => 7 }; security = update.fetch("groups").fetch(group); abort "wrong security group for #{ecosystem}" unless security == { "applies-to" => "security-updates", "patterns" => ["*"] } }'
```

Expected: fail with `Errno::ENOENT` because `.github/dependabot.yml` does not
yet exist.

- [ ] **Step 2: Create `.github/dependabot.yml`**

```yaml
version: 2

updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
      day: "monday"
      time: "11:00"
      timezone: "America/Los_Angeles"
    cooldown:
      default-days: 7
    groups:
      security-vulnerabilities-npm:
        applies-to: "security-updates"
        patterns:
          - "*"

  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
      day: "monday"
      time: "11:00"
      timezone: "America/Los_Angeles"
    cooldown:
      default-days: 7
    groups:
      security-vulnerabilities-github-actions:
        applies-to: "security-updates"
        patterns:
          - "*"
```

- [ ] **Step 3: Run the configuration contract after adding the file**

Run:

```bash
ruby -e 'require "yaml"; config = YAML.load_file(".github/dependabot.yml"); expected = { "npm" => "security-vulnerabilities-npm", "github-actions" => "security-vulnerabilities-github-actions" }; abort "expected version 2" unless config["version"] == 2; expected.each { |ecosystem, group| update = config.fetch("updates").find { |entry| entry["package-ecosystem"] == ecosystem }; abort "missing #{ecosystem}" unless update; abort "wrong directory for #{ecosystem}" unless update["directory"] == "/"; schedule = update.fetch("schedule"); abort "wrong schedule for #{ecosystem}" unless schedule == { "interval" => "weekly", "day" => "monday", "time" => "11:00", "timezone" => "America/Los_Angeles" }; abort "wrong cooldown for #{ecosystem}" unless update.fetch("cooldown") == { "default-days" => 7 }; security = update.fetch("groups").fetch(group); abort "wrong security group for #{ecosystem}" unless security == { "applies-to" => "security-updates", "patterns" => ["*"] } }'
```

Expected: exit 0 with no output.

- [ ] **Step 4: Check YAML formatting and the scoped diff**

Run:

```bash
git diff --check && git diff -- .github/dependabot.yml
```

Expected: exit 0; the diff contains only the intended Dependabot policy.

- [ ] **Step 5: Commit the policy**

```bash
git add .github/dependabot.yml
git commit -m "chore: configure Dependabot updates"
```

Expected: Git reports one new Dependabot configuration file committed.

### Task 2: Confirm GitHub acceptance after push

**Files:**
- Modify: none
- Test: GitHub Dependabot status for this repository

- [ ] **Step 1: Push the policy commit through the normal repository workflow**

Run:

```bash
git push
```

Expected: the remote branch receives the Dependabot policy.

- [ ] **Step 2: Review Dependabot's repository status**

Open the repository's **Insights → Dependency graph → Dependabot** view after
GitHub has processed the configuration.

Expected: both npm and GitHub Actions are configured without a configuration
error. Version updates honor the cooldown; security updates remain
alert-triggered and use the security-only group identifiers when grouped.
