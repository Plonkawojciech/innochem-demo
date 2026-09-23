"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { CustomerAddress } from "@/lib/server/account";
type Address = {
  id: string;
  label: string;
  version: number;
  archived: boolean;
  data: CustomerAddress;
};
async function send(url: string, body: unknown, method = "PUT") {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}
export function ProfileForm({
  firstName,
  lastName,
  version,
}: {
  firstName: string;
  lastName: string;
  version: number;
}) {
  const router = useRouter(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      await send("/api/account/profile", {
        version,
        firstName: String(f.get("firstName") || ""),
        lastName: String(f.get("lastName") || ""),
      });
      router.refresh();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Nie udało się zapisać danych.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit}>
      <div className="field-grid">
        <label className="f">
          Imię
          <input
            name="firstName"
            defaultValue={firstName}
            required
            maxLength={100}
            autoComplete="given-name"
          />
        </label>
        <label className="f">
          Nazwisko
          <input
            name="lastName"
            defaultValue={lastName}
            required
            maxLength={100}
            autoComplete="family-name"
          />
        </label>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button className="btn btn-primary" disabled={busy}>
        {busy ? "Zapisywanie…" : "Zapisz dane"}
      </button>
    </form>
  );
}
export function AddressForm({
  address,
  firstName = "",
  lastName = "",
  onSaved,
}: {
  address?: Address;
  firstName?: string;
  lastName?: string;
  onSaved?: () => void;
}) {
  const router = useRouter(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const form = e.currentTarget,
      f = new FormData(form),
      s = (k: string) => String(f.get(k) || "");
    try {
      await send(
        `/api/account/addresses${address ? `/${address.id}` : ""}`,
        {
          version: address?.version,
          label: s("label"),
          data: {
            firstName: s("firstName"),
            lastName: s("lastName"),
            street: s("street"),
            street2: s("street2"),
            postalCode: s("postalCode"),
            city: s("city"),
            country: s("country").toUpperCase(),
            company: s("company"),
            nip: s("nip"),
            phone: s("phone"),
          },
        },
        address ? "PUT" : "POST",
      );
      if (!address) form.reset();
      onSaved?.();
      router.refresh();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Nie udało się zapisać adresu.",
      );
    } finally {
      setBusy(false);
    }
  }
  const value = (key: keyof CustomerAddress) => address?.data[key] || "";
  return (
    <form onSubmit={submit}>
      <label className="f">
        Nazwa adresu
        <input
          name="label"
          defaultValue={address?.label}
          placeholder="np. Dom lub Firma"
          required
          maxLength={80}
        />
      </label>
      <div className="field-grid">
        <label className="f">
          Imię odbiorcy
          <input
            name="firstName"
            defaultValue={value("firstName") || firstName}
            required
            maxLength={100}
            autoComplete="given-name"
          />
        </label>
        <label className="f">
          Nazwisko odbiorcy
          <input
            name="lastName"
            defaultValue={value("lastName") || lastName}
            required
            maxLength={100}
            autoComplete="family-name"
          />
        </label>
      </div>
      <label className="f">
        Ulica i numer
        <input
          name="street"
          defaultValue={value("street")}
          required
          maxLength={180}
          autoComplete="address-line1"
        />
      </label>
      <label className="f">
        Dodatkowe informacje adresowe
        <input
          name="street2"
          defaultValue={value("street2")}
          maxLength={180}
          autoComplete="address-line2"
        />
      </label>
      <div className="field-grid">
        <label className="f">
          Kod pocztowy
          <input
            name="postalCode"
            defaultValue={value("postalCode")}
            required
            maxLength={20}
            autoComplete="postal-code"
          />
        </label>
        <label className="f">
          Miejscowość
          <input
            name="city"
            defaultValue={value("city")}
            required
            maxLength={100}
            autoComplete="address-level2"
          />
        </label>
        <label className="f">
          Kod kraju (np. PL)
          <input
            name="country"
            defaultValue={value("country") || "PL"}
            required
            pattern="[a-zA-Z]{2}"
            maxLength={2}
            autoComplete="country"
          />
        </label>
        <label className="f">
          Telefon
          <input
            name="phone"
            defaultValue={value("phone")}
            type="tel"
            maxLength={25}
            autoComplete="tel"
          />
        </label>
      </div>
      <div className="field-grid">
        <label className="f">
          Firma (opcjonalnie)
          <input
            name="company"
            defaultValue={value("company")}
            maxLength={180}
            autoComplete="organization"
          />
        </label>
        <label className="f">
          NIP (opcjonalnie)
          <input name="nip" defaultValue={value("nip")} maxLength={30} />
        </label>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button className="btn btn-primary" disabled={busy}>
        {busy ? "Zapisywanie…" : "Zapisz adres"}
      </button>
    </form>
  );
}
function SavedAddress({ address }: { address: Address }) {
  const router = useRouter(),
    [edit, setEdit] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function archive() {
    setBusy(true);
    setError("");
    try {
      await send(`/api/account/addresses/${address.id}/archive`, {
        version: address.version,
        archived: !address.archived,
      });
      router.refresh();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Nie udało się zmienić adresu.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="saved-address">
      <h3>{address.label}</h3>
      {edit ? (
        <AddressForm address={address} onSaved={() => setEdit(false)} />
      ) : (
        <address>
          {address.data.firstName} {address.data.lastName}
          <br />
          {address.data.company && (
            <>
              {address.data.company}
              <br />
            </>
          )}
          {address.data.street}
          <br />
          {address.data.street2 && (
            <>
              {address.data.street2}
              <br />
            </>
          )}
          {address.data.postalCode} {address.data.city}
          <br />
          {address.data.country}
        </address>
      )}
      <div className="address-actions">
        {!address.archived && (
          <button
            className="text-button"
            type="button"
            onClick={() => setEdit(!edit)}
          >
            {edit ? "Zamknij edycję" : "Edytuj"}
          </button>
        )}
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={() => void archive()}
        >
          {address.archived ? "Przywróć adres" : "Przenieś do archiwum"}
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </article>
  );
}
export function AddressBook({
  addresses,
  firstName,
  lastName,
}: {
  addresses: Address[];
  firstName: string;
  lastName: string;
}) {
  const [adding, setAdding] = useState(false);
  const active = addresses.filter((a) => !a.archived),
    archived = addresses.filter((a) => a.archived);
  return (
    <>
      <div className="account-heading">
        <h2 className="display">Zapisane adresy</h2>
        <button
          type="button"
          className="btn btn-outline"
          onClick={() => setAdding(!adding)}
        >
          {adding ? "Zamknij formularz" : "Dodaj adres"}
        </button>
      </div>
      {adding && (
        <div className="new-address">
          <AddressForm
            firstName={firstName}
            lastName={lastName}
            onSaved={() => setAdding(false)}
          />
        </div>
      )}
      {active.length ? (
        <div className="address-grid">
          {active.map((a) => (
            <SavedAddress key={`${a.id}:${a.version}`} address={a} />
          ))}
        </div>
      ) : (
        <p>Nie masz jeszcze zapisanych adresów.</p>
      )}
      {archived.length > 0 && (
        <details className="archived-addresses">
          <summary>Archiwalne adresy ({archived.length})</summary>
          <div className="address-grid">
            {archived.map((a) => (
              <SavedAddress key={`${a.id}:${a.version}`} address={a} />
            ))}
          </div>
        </details>
      )}
    </>
  );
}
