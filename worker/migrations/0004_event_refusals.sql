-- API.md clarification 16: a check-out remembers why its note or task list was not stored, so a resend's 200 duplicate answer
-- can still tell the phone. Worker-view answers only; never in the office or family views.
ALTER TABLE events ADD COLUMN note_refused TEXT;
ALTER TABLE events ADD COLUMN tasks_refused TEXT;
