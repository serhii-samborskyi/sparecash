import { useEffect, useRef, useState } from "react";
import { api, post } from "../api";
import { Field } from "./ui";
import { landingImages } from "../../server/landing-images";

type ImageValue = { src: string; alt: string };
type Asset = ImageValue & { name: string };
export function LandingAssetPicker({
  label,
  kind,
  value,
  onChange,
  onUploadChange,
}: {
  label: string;
  kind: "HERO" | "LOGO" | "SECTION";
  value?: ImageValue;
  onChange: (value: ImageValue | undefined) => void;
  onUploadChange: (delta: number) => void;
}) {
  const [items, setItems] = useState<Asset[]>([]);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [file, setFile] = useState<File>();
  const [name, setName] = useState("");
  const [alt, setAlt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const latestChange = useRef(onChange);
  latestChange.current = onChange;
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      api(`/admin/landing-assets?page=${page}&q=${encodeURIComponent(q)}`)
        .then((data) => {
          if (active) {
            setItems(data.items);
            setTotal(data.total);
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [page, q, revision]);
  const library: Asset[] = [
    ...items,
    ...landingImages.filter((image) =>
      image.name.toLowerCase().includes(q.toLowerCase()),
    ),
  ];
  async function upload() {
    if (!file) return;
    onUploadChange(1);
    setBusy(true);
    setError("");
    try {
      if (file.size > 4 * 1024 * 1024)
        throw new Error("Choose an image smaller than 4 MiB.");
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = () => reject(new Error("Could not read this image"));
        reader.readAsDataURL(file);
      });
      const result = await post("/admin/landing-assets", {
        name,
        alt,
        kind,
        base64,
      });
      if (!mounted.current) return;
      latestChange.current({ src: result.src, alt: result.alt });
      setFile(undefined);
      setPage(1);
      setQ("");
      setRevision((v) => v + 1);
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      onUploadChange(-1);
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <div className="asset-picker">
      <Field label={`${label} library`}>
        <input
          type="search"
          placeholder="Search uploaded images"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
      </Field>
      <Field label={label}>
        <select
          value={value?.src ?? ""}
          disabled={busy}
          onChange={(e) => {
            const image = library.find((i) => i.src === e.target.value);
            onChange(image ? { src: image.src, alt: image.alt } : undefined);
          }}
        >
          <option value="">
            {kind === "LOGO" ? "Default SpareCash logo" : "No custom image"}
          </option>
          {value && !library.some((i) => i.src === value.src) && (
            <option value={value.src}>Current image</option>
          )}
          {library.map((i) => (
            <option key={i.src} value={i.src}>
              {i.name}
            </option>
          ))}
        </select>
      </Field>
      {total > 50 && (
        <div className="asset-pagination">
          <button
            type="button"
            className="button secondary"
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </button>
          <span>
            Page {page} of {Math.ceil(total / 50)}
          </span>
          <button
            type="button"
            className="button secondary"
            disabled={page * 50 >= total}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      )}
      {value && (
        <>
          <img
            className={`asset-preview ${kind === "LOGO" ? "asset-preview-logo" : ""}`}
            src={value.src}
            alt={value.alt}
          />
          <Field
            label={`${label} description`}
            hint="Describe the image for visitors using a screen reader."
          >
            <input
              value={value.alt}
              minLength={3}
              maxLength={240}
              onChange={(e) => onChange({ ...value, alt: e.target.value })}
            />
          </Field>
        </>
      )}
      <Field
        label={`Upload ${label.toLowerCase()}`}
        hint="PNG, JPEG or WebP, up to 4 MiB. Saved in your reusable media library."
      >
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={busy}
          onChange={(e) => {
            const selected = e.target.files?.[0];
            setFile(selected);
            setName(selected?.name.replace(/\.[^.]+$/, "").slice(0, 120) ?? "");
            setAlt("");
            setError("");
            e.target.value = "";
          }}
        />
      </Field>
      {file && (
        <div className="asset-upload-details">
          <Field label="Image name">
            <input
              value={name}
              maxLength={120}
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="Image description">
            <input
              placeholder={
                kind === "LOGO"
                  ? "SpareCash logo"
                  : "Describe what the image shows"
              }
              value={alt}
              maxLength={240}
              disabled={busy}
              onChange={(e) => setAlt(e.target.value)}
            />
          </Field>
          <button
            type="button"
            className="button secondary"
            disabled={busy || !name.trim() || alt.trim().length < 3}
            onClick={() => void upload()}
          >
            {busy ? "Uploading…" : "Upload and use image"}
          </button>
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {busy && <p role="status">Saving image…</p>}
    </div>
  );
}
