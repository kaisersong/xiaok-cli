Feature: Desktop local multi-agent execution in the output-right panel
  The source of truth is Electron main, never the renderer or CLI stdout.
  Frozen design: v14, SHA256 3ec81f1890e7c911e1e46cc6799a272dbf19dccfc43bfe92e6a12c8bc418e4a1
  These acceptance scenarios are exercised by production-boundary Vitest and real-entrypoint E2E tests.

  @A1 @lease @service
  Scenario: A root waits for two concurrent children without deadlocking capacity one
    Given the application has one execution slot and a local root owns a group lease
    When the root spawns two children and waits while another group queues
    Then both child executions start under the existing lease
    And the other group stays queued and can be cancelled without cancelling the children

  @A2 @capacity
  Scenario: Depth and full resident capacity reject immediately
    Given eight child slots include running, initializing, suspended and cleanup-pending records
    When a parent exceeds depth three or requests another child
    Then the request returns capacity_exceeded or capacity_reclaiming without waiting for dispose
    And no slot is reusable before its real cleanup completes

  @A3 @fork @protocol
  Scenario: The default inherited context preserves complete protocol batches
    Given a parent with complete tool history and a current batch containing two spawn calls
    When both children build their first request using the real Desktop session
    Then the strict provider accepts paired history without fabricated tool results
    And the parent's history remains unchanged and strict K3 receives its public synthesized prefix

  @A4 @mailbox
  Scenario: Main and child messages arrive at complete model boundaries
    Given a child is executing a tool or streaming its final public text
    When main and child send messages to each other before the next seal
    Then each confirmed message enters the next complete request exactly once
    And a waiting caller wakes for a message or settled terminal result

  @A5 @lifecycle
  Scenario: A retained child continues with its identity and history
    Given the root ended and a physically settled child retains its session
    When the next root follows up before idle TTL or capacity eviction
    Then the child reuses its agent ID and completed conversation history
    But after full reclamation followup returns expired without silently creating another ID

  @A6 @timeout
  Scenario: Idle, total and uncooperative execution timeouts stay distinguishable
    Given idle, continuously active and never-settling child sessions
    When their idle, turn or cleanup deadlines expire
    Then the failure reason is visible and the uncooperative execution remains resident
    And its worktree is not deleted and capacity is not overallocated

  @A7 @mcp
  Scenario: MCP replacement and late initialization respect ownership and cancellation
    Given a child capability awaits approval while its MCP owner is replaced
    When the old capability is revoked or the factory shuts down during initialization
    Then the late invocation is refused and the replacement owner's tool remains registered
    And unsettled cleanup is reported without starting a new operation

  @A8 @authorization
  Scenario: Control commands reject unauthorized scope and conflicting operations
    Given authenticated user and agent callers with different groups and ancestry
    When a caller controls a foreign group, ancestor or sibling, forges its source, or exceeds input limits
    Then the service rejects before mutation or execution
    And an identical operation ID returns its original result while changed parameters conflict

  @A9 @cancel
  Scenario: Cancellation competes with spawn, followup and late approval
    Given commands are waiting on a group sequencer or global FIFO
    When cancellation is ordered before their activation or approval completion
    Then no new session or tool starts after cancellation wins
    And only the targeted queued request is removed and the user's draft is preserved

  @A10 @subscription
  Scenario: Subscription installation cannot lose or cross-route events
    Given a snapshot is being installed while durable events arrive
    When duplicate, reordered, missing or old-group envelopes are delivered
    Then the active subscription deduplicates and fills gaps from its contiguous cursor
    And old subscription responses cannot change the selected conversation or reexecute commands

  @A11 @recovery
  Scenario: Persistence failures and restarts never fabricate success
    Given a running group and a fault-injectable real SQLite store
    When a write fails, the process crashes, the app restarts or its window hides
    Then write failure reports unknown and restart presents nonrunning read-only history
    And window hiding alone does not stop the live group

  @A12 @events
  Scenario: Child output, usage and artifacts keep their own provenance
    Given two children emit public output, usage and registered artifacts
    When the root task has already terminated
    Then child deltas stay out of the main assistant transcript and task completion guard
    And each usage ID is counted once and artifacts retain group, agent and source task IDs

  @A13 @registry
  Scenario: Every unsupported sibling registry rejects the seven control tools
    Given generic, KSwarm, room, automation and artifact-generation registries
    When each registry looks up and executes the seven multi-agent tools or an alias
    Then unsupported capabilities remain unavailable and MCP names cannot replace builtins
    And inline or predefined model overrides fail before worktree or adapter creation

  @A14 @goal
  Scenario: Goal completion accounts for outstanding child work and messages
    Given a Goal root is sealing while a child finishes, fails or persists its result
    When child state, user input and the completion decision race in either order
    Then the Goal waits for children or shows a failure requiring handling
    And a result is handed to the next root once without automatically completing the Goal

  @A15 @transaction
  Scenario: Prepared, applied and external side-effect boundaries recover independently
    Given real SQLite with failpoints before prepared, before applied and before activation
    When the app exits at each boundary or SQLITE_FULL occurs on output, cancel or terminal writes
    Then uncommitted work never activates and ambiguous applied work is unknown without replay
    And 64 KiB wire, 2 MiB content and 99 MiB ordinary-write limits remain enforced

  @A16 @lease
  Scenario: Join, last release and global blocking are linearized once
    Given a live group lease, an external waiter and two groups holding a total of eight sessions
    When joining and the last release occur in either order or one execution stalls
    Then refCount zero retires the lease, a new epoch gets a new deadline and only one group executes
    And runtime_blocked rejects all queued work without falsely releasing the stalled group

  @A17 @identity
  Scenario: Old root cancellation and old-window requests cannot control new work
    Given root A ended and root B or a reset group is current
    When an old cancel, old group result or unauthorized window request arrives
    Then the current root and projection remain unchanged
    And reset needs explicit confirmation and physical cleanup before changing the active group

  @A18 @admission
  Scenario: A child owns its ticket before spawn becomes visible
    Given a supported root owns a lease even if it has not spawned a child
    When a spawn is accepted while another group waits or applied persistence fails
    Then accepted children retain before the root can release its last ticket
    And invalid or failed admission calls the resource factory zero times

  @A19 @activation
  Scenario: External preparation has no model or mailbox side effects
    Given an externally activated coordinator and a long-running child
    When a second child is prepared but not activated and send or interrupt arrives
    Then preparation does not create a session, run a model or consume an inbox
    And short control acknowledgments do not wait for the long execution to settle

  @A20 @resources
  Scenario: Dormant groups and exclusive computer-use ownership are truthful
    Given reclaimed groups and two agents competing for the same formal computer-use resource
    When old root signals abort or the agents acquire the resource
    Then dormant coordinators and timers are reclaimed without reviving old executions
    And only one owner proceeds after a fresh observation while the other receives resource_busy

  @A21 @epochs
  Scenario: Interrupted epochs never reuse their aborted controller
    Given a live root and retained child checkpoints
    When user, watchdog, Goal or lease deadline stops the current execution epoch
    Then new work uses a fresh epoch only after physical settlement and unexpired sessions keep identity
    And application restart makes every old group historical-only without replay

  @A22 @ipc
  Scenario: Frame and execution permission revocation happen in main
    Given same-profile main windows, an iframe and a foreign workspace window
    When they subscribe or mutate and then workspace execution permission is revoked
    Then only authenticated main frames can access their authorized group
    And revocation invalidates every direct and alias invocation even after approval

  @A23 @limits
  Scenario: Messages and approval waits consume bounded budgets
    Given a large child result and a tool awaiting approval
    When the next model request is prepared or the approval arrives past the minimum deadline
    Then only a bounded preview enters context and unread messages stay unread on context failure
    And late approval never starts the tool and wait never extends execution deadlines

  @A24 @claims
  Scenario: A mailbox claim is not proof of model receipt
    Given a durable unread message claimed for a candidate request
    When cancel or write failure happens before confirm or a crash happens after confirm
    Then the unconfirmed claim returns to unread with cleared claim and turn fields
    And confirmed context stays context_applied with receipt unknown and is never replayed automatically

  @A25 @sqlite
  Scenario: Repeated recovery keeps identities, foreign keys and cleanup gates
    Given real SQLite holding roots, children, contents, operations and a never-settling execution
    When the store reopens twice or a user requests thread deletion
    Then old identities remain readable and invalid schema never causes destructive recreation
    And deletion remains pending with audit records until physical cleanup truly succeeds

  @A26 @worktree
  Scenario: Worktree recovery never guesses ownership or deletes dirty results
    Given a real git worktree journal and a process killed during allocation
    When startup reconciles keep, delete, dirty, mismatched-owner and unknown resources
    Then only clean correctly owned auto-delete worktrees are released non-forcibly
    And authorized user keep or retry is audited while agent and scheduler disposal requests are rejected

  @A27 @compatibility
  Scenario: Ordinary runners and old CLI mailbox behavior remain compatible
    Given an ordinary 40 minute task and a Desktop group with a persistence failure
    When the group resets or the ordinary task passes minute twenty-eight
    Then ordinary timeout semantics remain unchanged and reset-pending work is refused immediately
    And Desktop never calls the CLI synchronous takePendingInput callback

  @A28 @fifo
  Scenario: Ready user followup respects the same FIFO as ordinary work
    Given G1 owns a lease and X, ready user followup U, and Y arrive in that order
    When G1's final live member settles or U is cancelled
    Then admission is X, U, Y or X, Y without a second queue or double release
    And a second group without a live token cannot spawn despite owning idle sessions

  @A29 @first-request
  Scenario: First requests and recovery use actual bounded context
    Given unread results, old history requiring compression and a strict provider
    When the first root or child request is prepared or finalization is already past deadline
    Then the actual adapter receives the retained message-ID sentinel once or receives no expired request
    And unread claims, history pages and persistence-failure cancellation recover without false ACKs

  @A30 @opaque-tools
  Scenario: Opaque process capabilities make worktree cleanup manual before invocation
    Given bash or an MCP or skill alias has no verifiable external exit protocol
    When it is invoked on a managed worktree and the app later restarts
    Then manual cleanup eligibility was persisted before the side effect and the directory is retained
    And user keep never claims that arbitrary detached processes have exited

  @A31 @integration
  Scenario: Trusted root context reaches actual Chat and Goal loops
    Given supported Chat and Goal runner descriptors and unsupported sibling descriptors
    When roots start, children prepare and startup reconciliation remains incomplete
    Then only supported roots receive their own scoped context and tools
    And no execution crosses readiness or applied barriers and pending UI rows never claim running

  @A32 @followup
  Scenario: Following up a busy child queues a new admission instead of waiting on its old result
    Given A queues a followup of busy B while external X waits
    When A asks to wait for that followup and B's old turn settles
    Then wait reports queued rather than the old terminal result and X precedes the new B epoch
    And retained capability catalogs survive root registry disposal without inheriting newly added tools

  @A33 @cancel-seal
  Scenario: Root cancellation differs from the hard group deadline
    Given the root seals at minute 27:59 while a child still runs
    When root user, watchdog or Goal cancellation arrives and then minute 28:00 expires
    Then root cancellation is stale without host cancel and the root result remains unchanged
    And the lease expiry still aborts the child or marks runtime_blocked until physical settlement

  @A34 @settlement
  Scenario: Interrupt terminal status is not physical completion
    Given interruption changes the public status while the execution Promise never settles
    When a parent waits for that agent
    Then it receives stopping or cleanup_stalled with settled false and cleanup fields
    And only a real execution settlement may produce settledTerminal

  @A35 @replay
  Scenario: Reconnection fills details hidden by a newer metadata snapshot
    Given the last contiguous detail cursor is 100 and durable events 101 through 120 arrive offline
    When a snapshot at 120 and live event 121 arrive during paginated catch-up
    Then every missed message, output and result remains reachable without rolling back current status
    And overflow resubscribes from the last committed detail cursor within a bounded buffer

  @A36 @quota
  Scenario: Every growing durable row participates in the same byte quota
    Given messages, operation results and snapshots grow without any output event
    When inserts, updates, deletes and recovery recomputation approach the ordinary and reserve limits
    Then the same canonical UTF-8 delta accounting refuses excess writes atomically
    And repeated control failures cannot grow beyond reserve or suppress authorized physical abort

  @A37 @root-control
  Scenario: No direct agent-ID control path may bypass root cancellation binding
    Given authorized user and agent callers using IPC, aliases or generic tools
    When they follow up, interrupt or close root by its agent ID
    Then every path rejects while a legitimate send only stores a message
    And root cancellation still requires sourceTaskId and epoch and reset still requires confirmation

  @A38 @capabilities
  Scenario: Capability aliases cannot transfer authorization across owners or slots
    Given a child has an immutable owner-scoped slot upper bound and an approval is pending
    When names, revisions or owners change in the root catalog
    Then only a reauthorized same-slot non-expanding replacement may bind a fresh child invocation
    And old approvals, new slots, foreign owners and builtin-name collisions are refused

  @A39 @loop-budget
  Scenario: Every loop exit seals without inventing another iteration budget
    Given maxIterations is one and a pure-text final arrives with a newly unread message
    When the loop cannot continue and no tool-result finalization is needed
    Then it seals limit_reached as failure and retains the unread message
    And a tool-result finalization path uses at most N+1 requests and still returns partial failure

  @A40 @reset
  Scenario: Pending reset continues only within the owning process
    Given an applied reset waits for real cleanup and remembers an operation ID
    When cleanup settles, the same operation repeats, or the process restarts
    Then only the live continuation creates one new group and duplicate calls return the existing phase
    And after restart the operation is unknown until a new explicit user request

  @A41 @host
  Scenario: Multi-agent delivery failure does not silently rerun the same root ID
    Given the real TaskRuntimeHost has a failing deliverable gate
    When a multi-agent runner finishes and the post-seal check fails
    Then the runner was called once and the host shows failed with an explicit-followup requirement
    And ordinary runners retain their existing single automatic repair without killing background children

  @A42 @preparation
  Scenario: Root preparation survives each cross-store crash window
    Given a main-only identity reservation and a durable binding before host snapshot creation
    When the process exits before host creation, before index update, or before FIFO registration
    Then restart compensates both stores without model or tool execution or permanent understanding status
    And stale, forged, mismatched or late preparation cannot start or cancel a newer root

  @A43 @sender
  Scenario: User, main and child message identities survive restart
    Given each sender sends through its authenticated production path
    When messages persist, the app restarts and the UI pages through history
    Then sender kind and source labels remain distinct with valid same-group references
    And forged sender, caller or actor fields fail before mutation without changing CLI message semantics

  @U1 @renderer
  Scenario: Progress remains visible without reopening a manually collapsed panel
    Given a visible conversation and no user-selected file or task interaction
    When its first applied child appears, then the user collapses the panel and progress or failure arrives
    Then Agents opens once without stealing focus and later events only update badges
    And loading, disconnected, error, empty and completed states are distinguishable

  @U2 @renderer
  Scenario: Task, Agents and Canvas share one localized right-side surface
    Given each view has state and the composer has an unsent draft
    When the user switches views or uses keyboard navigation in Chinese and English
    Then one panel is visible, the draft and preview identity persist and focus returns correctly
    And every user-facing label comes from the locale contract

  @U3 @renderer
  Scenario: Large histories do not inflate the mounted output list
    Given at least sixteen historical agents and ten thousand durable events
    When the user pages through agent details and new activity arrives
    Then only bounded pages mount and the main transcript is not scrolled by child output
    And stable agent rows update without remounting the whole chat per chunk

  @U4 @accessibility
  Scenario: Crossing the responsive breakpoint preserves accessible focus
    Given focus is on a Task, Agents or Canvas control at width 900
    When the chat region shrinks to 899 and later expands again
    Then focus moves to an existing corresponding control and no detached activeElement remains
    And drawer inert and focus traps are removed when the drawer closes or becomes nonmodal

  @U5 @layout
  Scenario: Narrow first spawn never opens a modal automatically
    Given a narrow chat region or an expanded Canvas view
    When the first child appears or a retained lease approaches its deadline
    Then only a badge updates in narrow mode and Canvas keeps its original expanded width
    And remaining budget is accurate without adding a second TaskPanel width constraint

  @U6 @history
  Scenario: Historical groups remain discoverable without activating them
    Given only historical groups exist or a child is merely prepared
    When the user opens Agents history or drafts a new-agent request without submitting
    Then old groups are read-only, preparation is not shown as running and drafts create no execution
    And the Agents badge remains visible while Canvas is expanded

  @U7 @status
  Scenario: Unified entry labels and permanent-error actions match service behavior
    Given Task-only, Canvas-only and first-child states around the breakpoint
    When state, locale, failure or reset-pending status changes
    Then the entry name reflects the current view and unavailable actions stay disabled
    And activity announcements are throttled to ten seconds with each failure announced once

  @E1 @real-electron
  Scenario: A real Electron app exercises the complete control lifecycle
    Given an isolated app profile and a local strict OpenAI-compatible SSE fixture
    When actual preload and main execute spawn, send, wait, followup, interrupt and close
    Then real agent IDs and messages appear in the right panel and survive subscription changes
    And screenshots and provider request logs prove the complete lifecycle and cancellation boundaries

  @E2 @real-provider
  Scenario: Two real provider-backed children communicate in a short bounded task
    Given the configured provider is available and the task has no external mutation
    When the root creates two named children, exchanges messages and closes their sessions
    Then actual requests, IDs and delivered messages prove the round trip
    And provider quota or connectivity failure is reported separately from product regressions

  @E3 @packaging
  Scenario: The unsigned unpacked app runs the newly built feature
    Given fresh main, renderer, preload and verified sibling packaging inputs
    When the unsigned unpacked app starts through its actual executable
    Then its build identity is current and its right-panel lifecycle works with packaged resources
    And existence of build files or a background process alone is not considered success

  @CLI_DELTA @policy
  Scenario: Automatic delegation respects independent work and actual user decisions
    Given the local root and child prompts expose only their current tools and question transport
    When the user requests independent reviews without naming SubAgent or explicitly requests ask-first or solo work
    Then bounded useful work may be delegated early without redundant investigation
    And an unanswered, cancelled or rejected question never authorizes spawn, background work or followup
    And lack of a question transport is reported or handled by solo work, never by an invented answer

  @CLI_DELTA @permissions
  Scenario: Desktop consumes canonical CLI tool names without broadening empty intersections
    Given inline and predefined children request Read and Grep with explicit tool ceilings
    When their real Desktop loop inspects temporary source files
    Then allowed reads return real content and write remains unavailable
    And explicit empty tools, empty presets and empty intersections grant no extra capability

  @CLI_DELTA @presentation
  Scenario: Stable SubAgent names and real per-turn work survive replay
    Given twenty historical display instances with main-owned persistent ordinals
    When they are paged, reordered, followed up and shown after window recreation or process restart
    Then their names stay Pisces, Libra, Aries and the remaining frozen order with cycle suffixes
    And all names use one accent and italic styling without changing font configuration
    And per-turn assignments, elapsed time, completed and failed tool calls come only from actual execution facts
    And reused provider invocation IDs count distinct executions while repeated durable events do not count twice
    And failure, cancellation, budget exhaustion and unfinished cleanup never display false completion or release
