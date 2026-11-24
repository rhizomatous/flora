DROP TRIGGER immutable_installation_model;
CREATE TRIGGER immutable_installation_model BEFORE UPDATE OF provider,model ON installation_credentials
WHEN OLD.provider <> '' AND (NEW.provider <> OLD.provider OR NEW.model <> OLD.model)
BEGIN SELECT RAISE(ABORT, 'installation model is immutable'); END;
