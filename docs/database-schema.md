# Database Schema Conventions

This backend treats the relational schema as the source of truth for business
contracts and runtime behavior.

## Naming Convention

- Tables: `snake_case`, plural nouns for entity sets (`displays`, `playlists`)
- Join/target tables: explicit relationship names (`schedule_playlist_targets`)
- Columns: `snake_case`
- Foreign keys: `<referenced_entity>_id` (`display_id`, `content_id`)
- Status/enums: explicit enum columns, uppercase values for domain states

## Column Ordering Convention

Every table follows this order:

1. Primary key
2. Natural/business identifiers
3. Foreign keys
4. Core domain fields
5. State/status fields
6. Timestamps (`created_at`, `updated_at`, optional lifecycle timestamps)

## Normalized Structures Implemented

### Displays

- `displays`: identity + registration uniqueness
- `display_runtime_states`: mutable runtime telemetry/state
- `display_emergency_states`: emergency override state

### Display Keys

- `display_key_pairs`: full key history (append-only key records)
- `display_active_keys`: active key pointer per display

### Schedules

- `schedules`: shared scheduling window and activation fields
- `schedule_playlist_targets`: playlist target (one-to-one with schedule)
- `schedule_content_targets`: flash content target (one-to-one with schedule)

### Content

- `content`: core content identity/state hierarchy
- `content_assets`: file and media metadata
- `content_flash_messages`: flash-only message payload

### Auth Runtime Persistence

- `auth_sessions`
- `invitations`
- `password_reset_tokens`
- `email_change_tokens`

These tables replace Redis-backed durable auth records. Redis remains in use
for short-lived runtime concerns (pairing codes/sessions, nonce protection,
stream queues).
