UPDATE usage_steps SET cost_nanos=0 WHERE cost_nanos IS NULL AND EXISTS (
    SELECT 1 FROM usage_messages m, json_each(m.payload,'$.parts') p
    WHERE m.chat_id=usage_steps.chat_id AND m.session_id=usage_steps.session_id
      AND m.message_id=usage_steps.message_id
      AND json_extract(p.value,'$.id')=usage_steps.step_id
      AND json_extract(p.value,'$.type')='step-finish'
      AND json_type(p.value,'$.cost') IN ('integer','real')
      AND json_extract(p.value,'$.cost')=0
);
ALTER TABLE usage_messages DROP COLUMN pricing_known;
ALTER TABLE usage_messages DROP COLUMN incomplete;
