const common = [
  ["America/New_York", "Eastern — New York"],
  ["America/Chicago", "Central — Chicago"],
  ["America/Denver", "Mountain — Denver"],
  ["America/Phoenix", "Arizona — Phoenix"],
  ["America/Los_Angeles", "Pacific — Los Angeles"],
  ["America/Anchorage", "Alaska — Anchorage"],
  ["Pacific/Honolulu", "Hawaii — Honolulu"],
  ["America/Puerto_Rico", "Puerto Rico — Atlantic"],
  ["UTC", "UTC"],
];
const zones =
  typeof Intl.supportedValuesOf === "function"
    ? Intl.supportedValuesOf("timeZone")
    : [];
export function TimezoneSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      {!zones.includes(value) && !common.some(([zone]) => zone === value) && (
        <option value={value}>{value}</option>
      )}
      <optgroup label="Common time zones">
        {common.map(([zone, label]) => (
          <option value={zone} key={zone}>
            {label}
          </option>
        ))}
      </optgroup>
      <optgroup label="All time zones">
        {zones
          .filter((zone) => !common.some(([item]) => item === zone))
          .map((zone) => (
            <option key={zone} value={zone}>
              {zone.replaceAll("_", " ")}
            </option>
          ))}
      </optgroup>
    </select>
  );
}
