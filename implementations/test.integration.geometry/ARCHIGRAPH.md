# ArchiGraph Skill

This implementation folder is part of an ArchiGraph workspace. The architecture is defined in YAML and this code implements a specific component within it.

## Key Files

| Path | Purpose |
|------|---------|
| `./CLAUDE.md` | Implementation requirements for this component (AI-generated) |
| `../../archigraph.yaml` | Full system architecture — nodes, edges, views, rules |
| `../../schema.yaml` | Vocabulary — layers, node/edge kinds, custom fields, validation |
| `../../CLAUDE.md` | Workspace-level conventions |

## ArchiGraph Format (v0.3)

ArchiGraph describes system architecture as a directed graph:

- **Nodes**: Architectural elements (services, UIs, datastores, APIs, boundaries, code refs). Each has an `id`, `kind`, `layer`, `name`, and optional extension fields under `x.*`.
- **Edges**: Relationships between nodes (`uses`, `reads`, `writes`, `implements`, `contains`, etc.). Each has `kind`, `from`, `to`, `layer`, and optional `x.*` fields.
- **Views**: Named subsets of nodes/edges for focused diagrams.
- **Rules**: Validation constraints on the architecture.

The **schema** defines the allowed vocabulary — which layers, node kinds, edge kinds, and custom fields exist. Every workspace has its own schema tailored to the organisation.

## Architecture Feedback Loop

**The archigraph is the source of truth.** When implementing code, if you discover that the architecture is missing something — a new service, interface, datastore, boundary, edge, or field — **update `../../archigraph.yaml` first**, then continue the implementation.

Do not let the code silently diverge from the architecture. Examples:

- Need a cache that isn't modelled? Add the `datastore` node and its `reads`/`writes` edges before writing cache client code.
- Calling an endpoint with no `interface` node? Add the interface and its `implements`/`triggers` edges.
- An edge's protocol or auth mechanism is wrong? Fix the edge in `archigraph.yaml`.
- Discover a new trust boundary or external dependency? Model it as a node with appropriate edges.

## Code-to-ArchiGraph Traceability

Leave `@archigraph` comments in code that reference the node or edge being implemented. This creates a bidirectional map between architecture and code.

### Format

```
// @archigraph <node-id>        — for nodes
// @archigraph <uuid>           — prefer UUID when available
// @archigraph kind|from|to|layer  — for edges (composite key)
```

### Where to place them

- **Top of files**: `// @archigraph svc.auth` on files implementing a component
- **Functions/handlers**: `// @archigraph api.auth.login` on functions implementing an interface
- **Connections**: `// @archigraph reads|svc.crm_api|db.crm|data` on code establishing a connection
- **Config**: `// @archigraph cache.sessions` on configuration for a specific node

### Example

```typescript
// @archigraph svc.crm_api
export class CrmApiService {
  // @archigraph api.crm.list_customers
  async listCustomers() {
    // @archigraph reads|svc.crm_api|db.crm|data
    return this.db.query('SELECT * FROM customers');
  }

  // @archigraph api.crm.update_customer
  async updateCustomer(id: string, patch: Partial<Customer>) {
    // @archigraph writes|svc.crm_api|db.crm|data
    return this.db.update('customers', id, patch);
  }
}
```

## Sibling Folders

Other implementable nodes in the same workspace have their own folders at `../<node-id>/`. Check `./CLAUDE.md` for which specific siblings are relevant to this component and how they connect.

## Working With the Architecture

To understand this component's role in the system:

1. Read `./CLAUDE.md` for specific implementation requirements
2. Read `../../archigraph.yaml` to see how this component connects to the rest of the system
3. Search for edges where this component's ID appears in `from` or `to` fields
4. Read `../../schema.yaml` to understand available kinds, layers, and custom fields
