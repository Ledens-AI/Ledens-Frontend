-- UI metadata only. PR 21 remains the sole accounting/allocation/audit model.
CREATE TABLE ledens.finance_review_flags (
 record_id uuid PRIMARY KEY REFERENCES ledens.financial_records(id),
 needs_review boolean NOT NULL DEFAULT false,review_note text,
 updated_by uuid REFERENCES public.users(id),updated_at timestamptz NOT NULL DEFAULT now()
);
