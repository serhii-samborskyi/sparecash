export function BrandMark({
  className = "brand-logo",
}: {
  className?: string;
}) {
  return (
    <img
      className={className}
      src="/brand/sparecash-mark-128.png"
      alt=""
      aria-hidden="true"
      width={128}
      height={128}
    />
  );
}
