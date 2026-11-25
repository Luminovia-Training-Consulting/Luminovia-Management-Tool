BEGIN;

-- Annual forecasting has a separate bound; statements, timesheets and the
-- operations control center keep their existing 93-day limit.
CREATE FUNCTION private.finance_forecast_period(p_from date, p_until date)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  IF p_from IS NULL OR p_until IS NULL OR NOT isfinite(p_from) OR NOT isfinite(p_until)
    OR p_until <= p_from OR p_until - p_from > 367 THEN
    RAISE EXCEPTION 'Finite exclusive forecast period up to 367 days required' USING errcode = '22023';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.finance_forecast_period(date, date) FROM public, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.finance_forecast(p_from date, p_until date, p_pipeline_probability numeric DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE result jsonb; can_gross boolean; zone text; begins timestamptz; ends timestamptz;
BEGIN
  IF NOT private.has_permission('finance.manage') THEN
    RAISE EXCEPTION 'finance.manage and MFA required' USING errcode = '42501';
  END IF;
  PERFORM private.finance_forecast_period(p_from, p_until);
  IF p_pipeline_probability IS NULL OR p_pipeline_probability < 0 OR p_pipeline_probability > 1
    OR p_pipeline_probability::text IN ('NaN', 'Infinity', '-Infinity') THEN
    RAISE EXCEPTION 'Explicit pipeline probability from zero to one required' USING errcode = '22023';
  END IF;
  can_gross = private.has_permission('finance.gross.read');
  SELECT time_zone INTO zone FROM public.profiles WHERE id = auth.uid();
  begins = p_from::timestamp AT TIME ZONE zone;
  ends = p_until::timestamp AT TIME ZONE zone;
  -- Evaluate the amendment-aware cost once per in-range claim, then aggregate
  -- each source once rather than rescanning raw rows for each calendar bucket.
  WITH accepted_rows AS MATERIALIZED (
    SELECT date_trunc('month', sessions.starts_at AT TIME ZONE zone)::date AS month,
      c.currency, private.forecast_assignment_total(c.id) AS cost,
      l.gross_total_amount AS gross
    FROM public.job_claims c
    CROSS JOIN LATERAL (
      SELECT min(starts_at) AS starts_at FROM public.assignment_sessions
      WHERE claim_id = c.id AND released_at IS NULL
    ) sessions
    LEFT JOIN private.claim_revenue_ledger l ON can_gross AND l.claim_id = c.id
    WHERE c.status = 'confirmed' AND sessions.starts_at >= begins AND sessions.starts_at < ends
  ), accepted AS (
    SELECT month, currency, sum(cost) AS cost, sum(gross) AS gross,
      sum(gross - cost) AS margin, count(*) FILTER (WHERE gross IS NULL) AS unknown_gross
    FROM accepted_rows GROUP BY month, currency
  ), offer_rows AS (
    SELECT date_trunc('month', sessions.starts_at AT TIME ZONE zone)::date AS month,
      j.currency,
      greatest(0, j.capacity - (SELECT count(*) FROM public.job_claims c
        WHERE c.job_id = j.id AND c.status = 'confirmed'))::numeric AS slots,
      CASE WHEN fee.platform_percent_override IS NOT NULL THEN
        round(fee.gross_total_amount * fee.regular_percent / 100, 2)
        WHEN fee.pricing_mode <> 'role_split' OR fee.job_id IS NULL THEN j.total_amount
      END AS cost,
      CASE WHEN can_gross THEN fee.gross_total_amount END AS gross,
      CASE WHEN can_gross THEN CASE
        WHEN fee.platform_percent_override IS NOT NULL THEN
          fee.gross_total_amount - round(fee.gross_total_amount * fee.regular_percent / 100, 2)
        WHEN fee.pricing_mode = 'legacy' THEN fee.gross_total_amount - j.total_amount
      END END AS margin
    FROM public.jobs j
    CROSS JOIN LATERAL (SELECT min(starts_at) AS starts_at FROM public.job_sessions WHERE job_id = j.id) sessions
    LEFT JOIN private.job_commission_offers fee ON fee.job_id = j.id
    WHERE j.status = 'published' AND (j.claim_deadline IS NULL OR j.claim_deadline > now())
      AND sessions.starts_at > now() AND sessions.starts_at >= begins AND sessions.starts_at < ends
  ), offers AS (
    SELECT month, currency,
      round(sum(cost * slots) * p_pipeline_probability, 2) AS cost,
      round(sum(gross * slots) * p_pipeline_probability, 2) AS gross,
      round(sum(margin * slots) * p_pipeline_probability, 2) AS margin,
      sum(slots) FILTER (WHERE cost IS NULL) AS unknown_cost,
      sum(slots) FILTER (WHERE margin IS NULL) AS unknown_margin
    FROM offer_rows WHERE slots > 0 GROUP BY month, currency
  ), request_rows AS (
    SELECT date_trunc('month', sessions.starts_at AT TIME ZONE zone)::date AS month,
      r.payload->>'currency' AS currency,
      (r.payload->>'gross_total_amount')::numeric AS gross
    FROM private.client_course_requests r
    CROSS JOIN LATERAL (
      SELECT min((session->>'starts_at')::timestamptz) AS starts_at
      FROM jsonb_array_elements(r.payload->'sessions') AS items(session)
    ) sessions
    WHERE can_gross AND r.job_id IS NULL AND r.status = 'submitted'
      AND sessions.starts_at > now() AND sessions.starts_at >= begins AND sessions.starts_at < ends
  ), requests AS (
    SELECT month, currency, round(sum(gross) * p_pipeline_probability, 2) AS gross
    FROM request_rows GROUP BY month, currency
  ), payment_entries AS (
    SELECT date_trunc('month', p.paid_at AT TIME ZONE zone)::date AS month, p.currency, sum(p.amount) AS amount
    FROM public.payment_records p
    WHERE p.voided_at IS NULL AND p.paid_at >= begins AND p.paid_at < ends
    GROUP BY 1, 2
  ), calendar AS (
    SELECT month_start::date AS month
    FROM generate_series(
      date_trunc('month', p_from::timestamp),
      date_trunc('month', (p_until - 1)::timestamp),
      interval '1 month'
    ) AS months(month_start)
  ), currencies AS (
    SELECT currency FROM accepted UNION SELECT currency FROM offers
    UNION SELECT currency FROM requests UNION SELECT currency FROM payment_entries
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'month', calendar.month,
    'currency', currencies.currency,
    'accepted_lecturer_cost', coalesce(a.cost, 0),
    'accepted_gross_known', CASE WHEN can_gross THEN coalesce(a.gross, 0) END,
    'accepted_margin_known', CASE WHEN can_gross THEN coalesce(a.margin, 0) END,
    'unknown_gross_claims', CASE WHEN can_gross THEN coalesce(a.unknown_gross, 0) END,
    'pipeline_cost_unknown_positions', coalesce(o.unknown_cost, 0),
    'pipeline_lecturer_cost_known', CASE WHEN o.unknown_cost > 0 THEN NULL ELSE coalesce(o.cost, 0) END,
    'pipeline_gross_known', CASE WHEN can_gross THEN coalesce(o.gross, 0) + coalesce(r.gross, 0) END,
    'pipeline_margin_known', CASE WHEN can_gross THEN coalesce(o.margin, 0) END,
    'pipeline_margin_unknown_positions', CASE WHEN can_gross THEN coalesce(o.unknown_margin, 0) END,
    'lecturer_invoice_payments', coalesce(p.amount, 0)
  ) ORDER BY calendar.month, currencies.currency), '[]'::jsonb)
  INTO result FROM calendar CROSS JOIN currencies
  LEFT JOIN accepted a ON a.month = calendar.month AND a.currency = currencies.currency
  LEFT JOIN offers o ON o.month = calendar.month AND o.currency = currencies.currency
  LEFT JOIN requests r ON r.month = calendar.month AND r.currency = currencies.currency
  LEFT JOIN payment_entries p ON p.month = calendar.month AND p.currency = currencies.currency;
  RETURN jsonb_build_object(
    'from', p_from, 'until', p_until, 'time_zone', zone,
    'pipeline_probability', p_pipeline_probability, 'gross_authorized', can_gross,
    'payment_basis', 'lecturer_invoice_payment_records', 'months', result
  );
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;