# CLAUDE.md

# TurniDSP Development Guide

## Purpose
This document defines the permanent development rules for the TurniDSP project.
Follow these rules unless the user explicitly overrides them.

---

# Project Vision

TurniDSP is a Workforce Management Platform for Amazon DSP operations.

Core modules:

- Dashboard
- Employees
- Contracts
- Scheduler
- Absences
- Forecast
- Reports
- Vehicles
- Branches
- Operations Control Center

Goal:
HR manages people, contracts and absences.
The platform automatically manages scheduling.

---

# Core Principles

1. Preserve existing architecture.
2. PostgreSQL is the single source of truth.
3. Never redesign UI unless requested.
4. Never modify unrelated files.
5. Prefer incremental changes.
6. Maintain backward compatibility.

---

# Token Optimization

- Read only required files.
- Do not scan the whole repository.
- Do not read docs unless needed.
- Modify only affected modules.
- Return concise explanations.

---

# Database Rules

- PostgreSQL only.
- No JSON or localStorage for business data.
- Add migrations instead of destructive changes.
- Use transactions.
- Preserve foreign keys.
- Never drop production tables without approval.

---

# Employee Profile

Employee Profile is the single source of truth.

Contains:
- Personal data
- Contract
- Weekly hours
- Working days
- Branch
- Role
- Service
- Contract dates

All scheduling depends on this profile.

---

# Scheduler Engine

Scheduler is automatic.

Never manually create recurring contract shifts.

Generate shifts only from contract working days.

Never:
- rotate employees
- balance weekends
- invent scheduling logic

---

# Automatic Shift Generator

Generate monthly shifts automatically.

Rules:

- Only contract working days.
- Never outside contract dates.
- Ignore inactive employees.
- Ignore expired contracts.
- Regenerate only future affected shifts.

---

# Absence Synchronization

Approved absences override shifts.

Events:
- create
- update
- delete
- approve
- reject

Synchronize immediately.

Deleting an absence restores the generated shift.

---

# Scheduler Editing

Manual editing allowed only for:
- Route
- Vehicle
- Service
- Notes

Contract shifts remain system-managed.

---

# Dashboard

Dashboard uses live database data.

No duplicated calculations.

---

# Reports

Reports always query PostgreSQL.

---

# Performance

Target:

- 1000+ employees
- Multiple DSPs
- Multiple branches

Update only affected rows.

Avoid full recalculation.

---

# Security

- Validate all input.
- Use parameterized SQL.
- Respect role permissions.
- Log important operations.

---

# Coding Standards

- Small functions.
- Reusable code.
- Existing naming conventions.
- No unnecessary abstractions.
- No unrelated refactoring.

---

# File Modification Policy

Modify only required files.

Never:
- rename modules
- change folder structure
- rewrite unrelated files

---

# Response Style

Explain briefly.

Focus on implementation.

Show only relevant changes.

---

# Before Every Task

1. Understand request.
2. Locate required files.
3. Implement minimal change.
4. Preserve compatibility.
5. Verify logic.

---

# Long-Term Roadmap

TurniDSP evolves into an Automatic Workforce Management Platform.

Employee Profile → Scheduler

Contracts → Shift Generation

Absences → Real-time Synchronization

Forecast → Live Coverage

Reports → Live Analytics

Operations Control Center → Operational monitoring

HR manages people.

The platform manages schedules automatically.
