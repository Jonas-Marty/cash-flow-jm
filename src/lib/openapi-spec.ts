/**
 * OpenAPI 3.1 specification for the public REST API.
 *
 * Served as YAML at `/api/public/openapi.yaml` and rendered with Swagger UI
 * at `/api/docs`. Update this file whenever a public endpoint changes.
 */
export const openApiSpec = `openapi: 3.1.0
info:
  title: Cash Flow Public API
  version: "1.0.0"
  description: |
    Public REST API for the Cash Flow application.

    All endpoints (except cron/ops endpoints) require a personal API token,
    created in the app under Settings → API tokens, and passed as
    \`Authorization: Bearer <token>\`.

    Ops endpoints (\`/process-recurring\`, \`/prune-audit\`, \`/metrics\`) use the
    server-side \`METRICS_TOKEN\` env var instead and are intended for cron jobs.
servers:
  - url: https://cash-flow-jm.lovable.app
    description: Production
  - url: http://localhost:5173
    description: Local dev
security:
  - bearerAuth: []
tags:
  - name: Transactions
  - name: Pending transactions
  - name: Recurring rules
  - name: Account statements
  - name: Accounts
  - name: Categories
  - name: Attachments
  - name: Ops
paths:
  /api/public/transactions:
    post:
      tags: [Transactions]
      summary: Create a transaction
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/TransactionInput' }
      responses:
        '201':
          description: Created
          content:
            application/json:
              schema:
                type: object
                properties:
                  transaction: { $ref: '#/components/schemas/Transaction' }
        '400': { $ref: '#/components/responses/BadRequest' }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '404': { $ref: '#/components/responses/NotFound' }
  /api/public/pending-transactions:
    get:
      tags: [Pending transactions]
      summary: List pending transactions
      parameters:
        - in: query
          name: status
          schema: { type: string, enum: [pending, confirmed, rejected] }
        - in: query
          name: external_source
          schema: { type: string }
        - in: query
          name: external_ref
          description: One ref, or several separated by commas (max 200).
          schema: { type: string }
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                type: object
                properties:
                  pending_transactions:
                    type: array
                    items: { $ref: '#/components/schemas/PendingTransaction' }
        '401': { $ref: '#/components/responses/Unauthorized' }
    post:
      tags: [Pending transactions]
      summary: Create a pending transaction
      description: |
        Creates a pending transaction that the user will later confirm in the app.
        If \`(external_source, external_ref)\` matches an existing row it is returned
        with \`deduplicated: true\` instead of being inserted again.

        A capturing device may attach where the payment happened:
        \`latitude\`/\`longitude\` (required together), \`location_accuracy_m\` in
        metres, an optional \`location_label\`, and \`location_source\`
        (\`device\` | \`manual\` | \`search\`, defaulting to \`device\`). It is
        carried onto the transaction when the pending row is confirmed.

        If a point arrives without a \`location_label\`, the server borrows the
        name of the nearest already-labelled place whose description matches
        this one. Only the name is borrowed — the coordinates stay as measured.

        A row that arrives without a \`category_id\` gets one *suggested* behind
        the response: from the user's own history when the same merchant was
        booked before, otherwise from their configured AI connection. The
        suggestion lives in the \`suggested_*\` fields and is applied only when
        the user accepts it in the app; \`category_id\` stays as posted.
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/PendingTransactionInput' }
      responses:
        '200':
          description: Existing row returned (deduplicated)
          content:
            application/json:
              schema:
                type: object
                properties:
                  pending_transaction: { $ref: '#/components/schemas/PendingTransaction' }
                  deduplicated: { type: boolean }
        '201':
          description: Created
          content:
            application/json:
              schema:
                type: object
                properties:
                  pending_transaction: { $ref: '#/components/schemas/PendingTransaction' }
        '400': { $ref: '#/components/responses/BadRequest' }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '404': { $ref: '#/components/responses/NotFound' }
    delete:
      tags: [Pending transactions]
      summary: Delete a pending transaction
      description: |
        Deletes a row that is still \`pending\` or was \`rejected\`. Identify it
        either by \`id\` or by the \`(external_source, external_ref)\` pair.
        A \`confirmed\` row is refused with 409: it already produced a real
        transaction, which has to be undone in the app first.
      parameters:
        - in: query
          name: id
          schema: { type: string, format: uuid }
        - in: query
          name: external_source
          schema: { type: string }
        - in: query
          name: external_ref
          schema: { type: string }
      responses:
        '200':
          description: Deleted
          content:
            application/json:
              schema:
                type: object
                properties:
                  deleted: { type: boolean }
                  id: { type: string, format: uuid }
        '400': { $ref: '#/components/responses/BadRequest' }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '404': { $ref: '#/components/responses/NotFound' }
        '409':
          description: The pending transaction is already confirmed
  /api/public/recurring-rules:
    get:
      tags: [Recurring rules]
      summary: List recurring rules
      description: |
        Non-archived rules unless \`include_archived=true\`. \`accepts_proposals\`
        is true for the rules a bill proposal may target (variable amount, not
        archived); \`next_pending_occurrence\` is the next entry still waiting to
        be posted.
      parameters:
        - in: query
          name: include_archived
          schema: { type: boolean }
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                type: object
                properties:
                  recurring_rules:
                    type: array
                    items: { $ref: '#/components/schemas/RecurringRule' }
        '401': { $ref: '#/components/responses/Unauthorized' }
  /api/public/recurring-proposals:
    get:
      tags: [Recurring rules]
      summary: Look up bill proposals
      description: |
        What became of proposals sent earlier: \`status\` is the occurrence's
        (\`pending\` | \`posted\` | \`skipped\`), and \`transaction_id\` is set once
        the user posted it. A ref that is missing from a filtered response was
        discarded, or its occurrence was removed.
      parameters:
        - in: query
          name: external_source
          schema: { type: string }
        - in: query
          name: external_ref
          description: One ref, or several separated by commas (max 200).
          schema: { type: string }
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                type: object
                properties:
                  recurring_proposals:
                    type: array
                    items: { $ref: '#/components/schemas/RecurringProposal' }
        '401': { $ref: '#/components/responses/Unauthorized' }
    post:
      tags: [Recurring rules]
      summary: Propose amount and date for a recurring entry
      description: |
        A bill arrived: proposes its amount and date for the matching entry of a
        variable-amount recurring rule. Nothing is posted — the user sees the
        values, marked as provided by \`external_source\`, and posts by hand.

        The entry is the first occurrence of the rule scheduled no more than 7
        days before \`occurred_on\` and no further ahead than one interval. A
        newer proposal on the same pending entry replaces the older one.

        Refused with 409 when that entry is already posted (\`code:
        already_posted\`, with \`transaction_id\` — edit the transaction in the
        app instead) or skipped (\`code: skipped\`). Refused with 422 for a
        fixed-amount (\`fixed_amount\`) or archived (\`rule_archived\`) rule.
        The same \`(external_source, external_ref)\` again returns the first
        result with \`deduplicated: true\`.
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/RecurringProposalInput' }
      responses:
        '200':
          description: Existing proposal returned (deduplicated)
          content:
            application/json:
              schema:
                type: object
                properties:
                  recurring_proposal: { $ref: '#/components/schemas/RecurringProposal' }
                  deduplicated: { type: boolean }
        '201':
          description: Proposal stored on the entry
          content:
            application/json:
              schema:
                type: object
                properties:
                  recurring_proposal: { $ref: '#/components/schemas/RecurringProposal' }
        '400': { $ref: '#/components/responses/BadRequest' }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '404':
          description: Rule not found (\`rule_not_found\`) or no scheduled entry near the date (\`no_occurrence\`)
        '409':
          description: The entry is already posted or skipped
        '422':
          description: The rule does not accept proposals
    delete:
      tags: [Recurring rules]
      summary: Withdraw a bill proposal
      description: |
        Clears a proposal, identified by \`occurrence_id\` or by the
        \`(external_source, external_ref)\` pair. Refused with 409 once the entry
        is posted.
      parameters:
        - in: query
          name: occurrence_id
          schema: { type: string, format: uuid }
        - in: query
          name: external_source
          schema: { type: string }
        - in: query
          name: external_ref
          schema: { type: string }
      responses:
        '200':
          description: Cleared
          content:
            application/json:
              schema:
                type: object
                properties:
                  deleted: { type: boolean }
                  occurrence_id: { type: string, format: uuid }
        '400': { $ref: '#/components/responses/BadRequest' }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '404': { $ref: '#/components/responses/NotFound' }
        '409':
          description: The entry is already posted
  /api/public/account-statements:
    get:
      tags: [Account statements]
      summary: List account statements
      parameters:
        - in: query
          name: account_id
          schema: { type: string, format: uuid }
        - in: query
          name: from
          schema: { type: string, format: date }
        - in: query
          name: to
          schema: { type: string, format: date }
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                type: object
                properties:
                  statements:
                    type: array
                    items: { $ref: '#/components/schemas/AccountStatement' }
        '401': { $ref: '#/components/responses/Unauthorized' }
    post:
      tags: [Account statements]
      summary: Upsert an account statement (reconciliation)
      description: |
        Records the bank statement balance for an account at a given date.
        When \`auto_compensate\` is true and the difference against the computed
        balance is non-zero, a compensating transaction is posted in the
        "Reconciliation adjustment" category.
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/AccountStatementInput' }
      responses:
        '201':
          description: Upserted
          content:
            application/json:
              schema:
                type: object
                properties:
                  statement: { $ref: '#/components/schemas/AccountStatementResult' }
        '400': { $ref: '#/components/responses/BadRequest' }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '404': { $ref: '#/components/responses/NotFound' }
    delete:
      tags: [Account statements]
      summary: Delete an account statement
      parameters:
        - in: query
          name: id
          required: true
          schema: { type: string, format: uuid }
        - in: query
          name: delete_compensation
          schema: { type: boolean, default: false }
      responses:
        '200':
          description: Deleted
          content:
            application/json:
              schema: { type: object, properties: { ok: { type: boolean } } }
        '400': { $ref: '#/components/responses/BadRequest' }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '404': { $ref: '#/components/responses/NotFound' }
  /api/public/accounts:
    get:
      tags: [Accounts]
      summary: List accounts
      parameters:
        - in: query
          name: include_archived
          schema: { type: boolean, default: false }
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                type: object
                properties:
                  accounts:
                    type: array
                    items: { $ref: '#/components/schemas/Account' }
        '401': { $ref: '#/components/responses/Unauthorized' }
  /api/public/categories:
    get:
      tags: [Categories]
      summary: List categories and groups
      parameters:
        - in: query
          name: include_archived
          schema: { type: boolean, default: false }
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                type: object
                properties:
                  categories:
                    type: array
                    items: { $ref: '#/components/schemas/Category' }
                  groups:
                    type: array
                    items: { $ref: '#/components/schemas/CategoryGroup' }
        '401': { $ref: '#/components/responses/Unauthorized' }
  /api/public/attachments:
    post:
      tags: [Attachments]
      summary: Attach an external link to a transaction
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [transaction_id, link_url, display_name]
              properties:
                transaction_id: { type: string, format: uuid }
                link_url: { type: string, format: uri, maxLength: 2000 }
                display_name: { type: string, minLength: 1, maxLength: 255 }
                source: { type: string, minLength: 1, maxLength: 50, default: nextcloud }
      responses:
        '201':
          description: Created
          content:
            application/json:
              schema:
                type: object
                properties:
                  attachment: { $ref: '#/components/schemas/Attachment' }
        '400': { $ref: '#/components/responses/BadRequest' }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '404': { $ref: '#/components/responses/NotFound' }
  /api/public/process-recurring:
    post:
      tags: [Ops]
      summary: Process recurring rules for all users
      description: |
        Operator/cron endpoint. Authenticates with \`METRICS_TOKEN\`, not user tokens.
      parameters:
        - in: query
          name: today
          schema: { type: string, format: date }
          description: Optional override for the "today" date (YYYY-MM-DD).
      responses:
        '200':
          description: Processed
          content:
            application/json:
              schema:
                type: object
                properties:
                  users_processed: { type: integer }
                  today: { type: string, format: date }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '503': { description: 'METRICS_TOKEN not set' }
    get:
      tags: [Ops]
      summary: Process recurring rules (GET alias)
      responses:
        '200': { description: OK }
  /api/public/prune-audit:
    post:
      tags: [Ops]
      summary: Prune old audit log rows
      description: |
        Operator/cron endpoint. Authenticates with \`METRICS_TOKEN\`.
        Reads \`AUDIT_RETENTION_DAYS\` (default 365).
      responses:
        '200':
          description: Pruned
          content:
            application/json:
              schema:
                type: object
                properties:
                  deleted: { type: integer }
                  retention_days: { type: integer }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '503': { description: 'METRICS_TOKEN not set' }
    get:
      tags: [Ops]
      summary: Prune old audit log rows (GET alias)
      responses:
        '200': { description: OK }
  /api/public/metrics:
    get:
      tags: [Ops]
      summary: Prometheus scrape endpoint
      description: |
        Authenticates with \`METRICS_TOKEN\`. Returns Prometheus text exposition format.
      responses:
        '200':
          description: OK
          content:
            text/plain:
              schema: { type: string }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '503': { description: 'METRICS_TOKEN not set' }
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: API token
  responses:
    BadRequest:
      description: Invalid input
      content:
        application/json:
          schema: { $ref: '#/components/schemas/Error' }
    Unauthorized:
      description: Missing or invalid token
      content:
        application/json:
          schema: { $ref: '#/components/schemas/Error' }
    NotFound:
      description: Referenced resource not found or not owned by caller
      content:
        application/json:
          schema: { $ref: '#/components/schemas/Error' }
  schemas:
    Error:
      type: object
      properties:
        error: { type: string }
        details: { type: object, additionalProperties: true }
      required: [error]
    TransactionType:
      type: string
      enum: [expense, income, transfer]
    TransactionInput:
      type: object
      required: [type, amount, source_account_id]
      properties:
        type: { $ref: '#/components/schemas/TransactionType' }
        amount:
          description: Positive number. Accepts number or string ("12.34" / "12,34"). Rounded to 2 decimals.
          oneOf:
            - { type: number, exclusiveMinimum: 0 }
            - { type: string }
        occurred_on:
          type: string
          format: date
          description: Defaults to today if omitted.
        source_account_id: { type: string, format: uuid }
        destination_account_id:
          type: string
          format: uuid
          nullable: true
          description: Required for transfers, must differ from source.
        category_id:
          type: string
          format: uuid
          nullable: true
          description: Cleared automatically on transfers.
        description: { type: string, maxLength: 500, nullable: true }
        note: { type: string, maxLength: 2000, nullable: true }
        destination_amount:
          description: Only allowed on transfers. Positive number.
          nullable: true
          oneOf:
            - { type: number, exclusiveMinimum: 0 }
            - { type: string }
    Transaction:
      type: object
      properties:
        id: { type: string, format: uuid }
        occurred_on: { type: string, format: date }
        amount: { type: number }
        destination_amount: { type: number, nullable: true }
        type: { $ref: '#/components/schemas/TransactionType' }
        source_account_id: { type: string, format: uuid }
        destination_account_id: { type: string, format: uuid, nullable: true }
        category_id: { type: string, format: uuid, nullable: true }
        description: { type: string, nullable: true }
        note: { type: string, nullable: true }
        created_at: { type: string, format: date-time }
    PendingTransactionInput:
      type: object
      required: [source_account_id, amount]
      properties:
        source_account_id: { type: string, format: uuid }
        amount:
          oneOf:
            - { type: number, exclusiveMinimum: 0 }
            - { type: string }
        type: { $ref: '#/components/schemas/TransactionType' }
        occurred_on: { type: string, format: date }
        destination_account_id: { type: string, format: uuid, nullable: true }
        category_id: { type: string, format: uuid, nullable: true }
        description: { type: string, maxLength: 500, nullable: true }
        note: { type: string, maxLength: 2000, nullable: true }
        destination_amount:
          nullable: true
          oneOf:
            - { type: number, exclusiveMinimum: 0 }
            - { type: string }
        external_source:
          type: string
          maxLength: 120
          nullable: true
          description: Combined with external_ref for idempotency.
        external_ref: { type: string, maxLength: 200, nullable: true }
        external_info: { type: string, maxLength: 2000, nullable: true }
        latitude: { type: number, minimum: -90, maximum: 90, nullable: true }
        longitude: { type: number, minimum: -180, maximum: 180, nullable: true }
        location_accuracy_m:
          type: number
          minimum: 0
          nullable: true
          description: Radius in metres. A phone fix indoors is routinely 20-100 m.
        location_label: { type: string, maxLength: 200, nullable: true }
        location_source: { type: string, enum: [device, manual, search], nullable: true }
    PendingTransaction:
      type: object
      properties:
        id: { type: string, format: uuid }
        status: { type: string, enum: [pending, confirmed, rejected] }
        source_account_id: { type: string, format: uuid }
        amount: { type: number }
        type: { $ref: '#/components/schemas/TransactionType' }
        occurred_on: { type: string, format: date }
        destination_account_id: { type: string, format: uuid, nullable: true }
        destination_amount: { type: number, nullable: true }
        category_id: { type: string, format: uuid, nullable: true }
        description: { type: string, nullable: true }
        note: { type: string, nullable: true }
        external_source: { type: string, nullable: true }
        external_ref: { type: string, nullable: true }
        external_info: { type: string, nullable: true }
        latitude: { type: number, nullable: true }
        longitude: { type: number, nullable: true }
        location_accuracy_m: { type: number, nullable: true }
        location_label: { type: string, nullable: true }
        location_source: { type: string, enum: [device, manual, search], nullable: true }
        suggested_description:
          type: string
          nullable: true
          description: Proposed by history or AI; not applied until the user accepts it.
        suggested_category_id: { type: string, format: uuid, nullable: true }
        suggested_tags: { type: array, items: { type: string } }
        suggestion_source:
          type: string
          enum: [history, ai]
          nullable: true
          description: Null with suggested_at set means the row was examined and nothing was worth proposing.
        suggestion_confidence: { type: number, minimum: 0, maximum: 1, nullable: true }
        suggested_at: { type: string, format: date-time, nullable: true }
        confirmed_transaction_id: { type: string, format: uuid, nullable: true }
        confirmed_at: { type: string, format: date-time, nullable: true }
        rejected_at: { type: string, format: date-time, nullable: true }
        reject_reason: { type: string, nullable: true }
        created_at: { type: string, format: date-time }
        updated_at: { type: string, format: date-time }
    RecurringRule:
      type: object
      properties:
        id: { type: string, format: uuid }
        name: { type: string }
        type: { $ref: '#/components/schemas/TransactionType' }
        amount: { type: number, nullable: true }
        estimated_amount: { type: number, nullable: true }
        is_variable_amount: { type: boolean }
        is_variable_date: { type: boolean }
        auto_post: { type: boolean }
        source_account_id: { type: string, format: uuid }
        category_id: { type: string, format: uuid, nullable: true }
        recurrence_interval: { type: integer, description: Months between entries }
        starts_on: { type: string, format: date }
        ends_on: { type: string, format: date, nullable: true }
        archived: { type: boolean }
        accepts_proposals: { type: boolean }
        next_pending_occurrence:
          type: object
          nullable: true
          properties:
            due_on: { type: string, format: date }
            effective_on: { type: string, format: date }
    RecurringProposalInput:
      type: object
      required: [recurring_rule_id, amount, occurred_on, external_source, external_ref]
      properties:
        recurring_rule_id: { type: string, format: uuid }
        amount: { type: number, exclusiveMinimum: 0 }
        occurred_on: { type: string, format: date, description: The bill's date; pre-fills the transaction date }
        external_source: { type: string, maxLength: 120, description: Shown to the user as the provider, e.g. FinReader }
        external_ref: { type: string, maxLength: 200 }
        external_info: { type: string, maxLength: 2000, nullable: true }
    RecurringProposal:
      type: object
      properties:
        occurrence_id: { type: string, format: uuid }
        recurring_rule_id: { type: string, format: uuid }
        rule_name: { type: string, nullable: true }
        due_on: { type: string, format: date }
        effective_on: { type: string, format: date }
        status: { type: string, enum: [pending, posted, skipped] }
        transaction_id: { type: string, format: uuid, nullable: true }
        amount: { type: number, nullable: true }
        occurred_on: { type: string, format: date, nullable: true }
        external_source: { type: string, nullable: true }
        external_ref: { type: string, nullable: true }
        proposed_at: { type: string, format: date-time, nullable: true }
    AccountStatementInput:
      type: object
      required: [account_id, as_of, statement_balance]
      properties:
        account_id: { type: string, format: uuid }
        as_of: { type: string, format: date }
        statement_balance:
          description: Statement balance (any sign). Number or string.
          oneOf:
            - { type: number }
            - { type: string }
        source: { type: string, maxLength: 64, default: api, pattern: '^[a-zA-Z0-9_.:-]+$' }
        external_ref: { type: string, maxLength: 255, nullable: true }
        note: { type: string, maxLength: 2000, nullable: true }
        auto_compensate:
          type: boolean
          default: false
          description: If true and diff != 0, post a compensating transaction.
    AccountStatement:
      type: object
      properties:
        id: { type: string, format: uuid }
        account_id: { type: string, format: uuid }
        as_of: { type: string, format: date }
        statement_balance: { type: number }
        source: { type: string }
        external_ref: { type: string, nullable: true }
        note: { type: string, nullable: true }
        status: { type: string, enum: [open, matched, compensated] }
        compensation_transaction_id: { type: string, format: uuid, nullable: true }
    AccountStatementResult:
      allOf:
        - { $ref: '#/components/schemas/AccountStatement' }
        - type: object
          properties:
            computed_balance: { type: number }
            diff: { type: number }
    Account:
      type: object
      properties:
        id: { type: string, format: uuid }
        name: { type: string }
        type: { type: string }
        archived: { type: boolean }
        currency_code: { type: string, nullable: true }
        currency_symbol: { type: string, nullable: true }
    Category:
      type: object
      properties:
        id: { type: string, format: uuid }
        name: { type: string }
        group_id: { type: string, format: uuid, nullable: true }
        rolls_over: { type: boolean }
        archived: { type: boolean }
        sort_order: { type: integer, nullable: true }
    CategoryGroup:
      type: object
      properties:
        id: { type: string, format: uuid }
        name: { type: string }
        kind: { type: string, nullable: true }
        sort_order: { type: integer, nullable: true }
        archived: { type: boolean }
    Attachment:
      type: object
      properties:
        id: { type: string, format: uuid }
        transaction_id: { type: string, format: uuid }
        link_url: { type: string, format: uri }
        display_name: { type: string }
        source: { type: string }
        added_at: { type: string, format: date-time }
`;