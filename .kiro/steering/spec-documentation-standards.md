---
inclusion: always
---

# Specification Documentation Standards

This document defines the standards for creating and maintaining specification documents across all project phases.

## Document Structure

### Required Documents per Phase

Each phase folder MUST contain:
1. **README.md** - Overview and navigation
2. **requirements.md** - Complete requirements specification
3. **tasks.md** - Implementation task breakdown

Optional documents:
- **design.md** - Technical design (for complex phases)
- **Archive/** folder - Supporting/historical documents

### Folder Organization

```
.kiro/specs/phase-X-name/
├── README.md           # Overview and navigation
├── requirements.md     # Requirements specification
├── tasks.md           # Task breakdown
├── design.md          # Technical design (optional)
└── Archive/           # Supporting documents (optional)
```

## README.md Format

Keep READMEs minimal and focused:

```markdown
# Phase X: Name

**Status**: 📋 Planned | 🟡 In Progress | ✅ Complete
**Dependencies**: Phase Y, Phase Z
**Estimated Duration**: X-Y weeks

---

## Documents

- **[requirements.md](./requirements.md)** - Brief description
- **[design.md](./design.md)** - Brief description (if exists)
- **[tasks.md](./tasks.md)** - Brief description

Supporting documents in [Archive/](./Archive/) folder (if exists).

---

## Overview

Brief 2-3 paragraph overview of the phase.

**Core Features**:
- Feature 1
- Feature 2
- Feature 3

---

**Last Updated**: Date
```

**Rules**:
- No detailed feature lists (that's in requirements.md)
- No timeline breakdowns (that's in tasks.md)
- No design details (that's in design.md)
- Keep it under 50 lines

## requirements.md Format

### Header

```markdown
# Phase X: Name - Requirements

## Overview

Brief overview paragraph.

## Goals

- Goal 1
- Goal 2
- Goal 3

## Requirements

[Requirements organized by sections]

---

## Dependencies

- Phase Y: Description
- Phase Z: Description

## Success Criteria

- Criterion 1
- Criterion 2

## Out of Scope

- Item 1 - Reason
- Item 2 - Reason

## Notes

- Important note 1
- Important note 2

---

**Status**: 📋 Planned
**Dependencies**: Phase Y, Phase Z
**Next Phase**: Phase X+1
```

### Requirement Format

```markdown
#### Requirement N: Title

**User Story**: As a [role], I want [feature], so that [benefit].

##### Acceptance Criteria

1. THE system SHALL [requirement]
2. THE system SHALL [requirement]
...
```

**Rules**:
- Use "THE system SHALL" format (not "should" or "must")
- Number all acceptance criteria
- Be specific and testable
- No implementation details (save for design.md)

## tasks.md Format

### Header

```markdown
# Phase X: Name - Tasks

## Overview

Brief overview of task organization.

## Task Status Legend

- ✅ **Complete**: Task is finished and verified
- 🟡 **In Progress**: Task is currently being worked on
- 📋 **Planned**: Task is defined but not started
- ⏸️ **Blocked**: Task is waiting on dependencies
- ❌ **Cancelled**: Task is no longer needed

---
```

### Task Format

```markdown
## N. Section Name

### N.M Subsection Name
- [ ] Task description
- [ ] Task description
- [ ] Task description

#### N.M.P Detailed Task (optional)
- [ ] Subtask 1
- [ ] Subtask 2
```

**CRITICAL RULES**:
- ❌ NO time estimates
- ❌ NO effort estimates
- ❌ NO "Status:", "Effort:", "Dependencies:" metadata
- ❌ NO "Week 1", "Week 2" labels
- ✅ Use simple checkboxes only
- ✅ Use status emojis inline if needed (e.g., "- [x] ✅ Task")
- ✅ Keep task descriptions concise
- ✅ Group related tasks together

### Example (CORRECT)

```markdown
## 1. Database Setup

### 1.1 Migrations
- [ ] Create users table migration
- [ ] Create organizations table migration
- [ ] Test migrations in development

### 1.2 Seed Data
- [ ] Create seed script
- [ ] Add test users
- [ ] Add test organizations
```

### Example (INCORRECT - DO NOT USE)

```markdown
## Phase 1: Database Setup (Week 1)

**Goal**: Set up database schema

### Task 1.1: Create Users Table Migration
**Status**: ⬜ Not Started
**Effort**: 2 hours
**Dependencies**: None

- [ ] Create migration file
- [ ] Add columns
- [ ] Test migration
```

## design.md Format (Optional)

Only create design.md for complex phases that need detailed technical specifications.

### Structure

```markdown
# Phase X: Name - Design Document

**Date**: Date
**Status**: 🎨 Design Phase
**Dependencies**: Phase Y, Phase Z

---

## Overview

Brief overview.

---

## Table of Contents

1. [Database Schema](#1-database-schema)
2. [Service Architecture](#2-service-architecture)
3. [API Endpoints](#3-api-endpoints)
...

---

## 1. Database Schema

[Detailed schema]

## 2. Service Architecture

[Detailed architecture]

...
```

**Rules**:
- Include table of contents for navigation
- Use code blocks for schemas, interfaces, examples
- Include diagrams where helpful (ASCII art is fine)
- Keep it technical and detailed
- Reference requirements.md for "why", focus on "how"

## Status Indicators

Use consistent status indicators across all documents:

- 📋 **Planned** - Not started
- 🟡 **In Progress** - Currently being worked on
- ✅ **Complete** - Finished and verified
- ⏸️ **Blocked** - Waiting on dependencies
- ❌ **Cancelled** - No longer needed

## Archive Folder

Use Archive/ folder for:
- Historical documents (summaries, status reports)
- Supporting analysis (pricing analysis, policy guides)
- Interim documents (design iterations, planning notes)

**Rules**:
- Don't reference archived docs from main docs
- Keep main folder clean (3-4 files max)
- Archive is for reference only

## Consistency Checklist

Before finalizing any phase documentation:

- [ ] README.md follows standard format (under 50 lines)
- [ ] requirements.md uses "THE system SHALL" format
- [ ] tasks.md has NO time/effort estimates
- [ ] tasks.md uses standard status legend
- [ ] All documents use consistent status indicators
- [ ] Supporting docs moved to Archive/ folder
- [ ] No duplicate information across documents
- [ ] All cross-references are accurate

## Common Mistakes to Avoid

1. ❌ Adding time estimates to tasks.md
2. ❌ Using different status legends across phases
3. ❌ Putting detailed requirements in README.md
4. ❌ Putting implementation details in requirements.md
5. ❌ Creating too many supporting documents in main folder
6. ❌ Using inconsistent formatting across phases
7. ❌ Forgetting to update "Last Updated" dates

## When to Create design.md

Create design.md when:
- Phase has complex architecture (multiple services, integrations)
- Database schema is extensive (10+ tables)
- API has 20+ endpoints
- Multiple external integrations
- Complex business logic

Skip design.md when:
- Phase is straightforward
- Requirements are self-explanatory
- Implementation is obvious from requirements

## Document Maintenance

- Update "Last Updated" date when making changes
- Keep documents in sync (if requirement changes, update tasks)
- Archive old versions before major rewrites
- Review consistency across phases periodically

---

**Purpose**: Maintain consistency across all phase documentation  
**Applies to**: All phases in .kiro/specs/  
**Last Updated**: June 10, 2026
