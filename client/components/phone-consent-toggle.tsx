export function PhoneConsentToggle({
  checked,
  consentText,
  onChange,
  required = true,
}: {
  checked: boolean;
  consentText: string;
  onChange: (checked: boolean) => void;
  required?: boolean;
}) {
  return (
    <label className="phone-consent-toggle">
      <input
        type="checkbox"
        checked={checked}
        required={required}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="phone-consent-switch" aria-hidden="true">
        <span />
      </span>
      <span className="phone-consent-copy">
        <strong>Calls and messages</strong>
        <small>{consentText}</small>
      </span>
    </label>
  );
}
