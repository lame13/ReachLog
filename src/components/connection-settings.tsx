"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  connectionDefinitions,
  type ConnectionGroup,
  type ConnectionResult,
  type ConnectionView,
} from "@/modules/connections/fields";
import { connectionAction } from "@/modules/connections/actions";

export function ConnectionSettings({
  views,
  demo,
}: {
  views: ConnectionView[];
  demo: boolean;
}) {
  const [selected, setSelected] = useState<ConnectionGroup>("smtp");
  return (
    <section
      id="connections"
      className="scroll-mt-28 rounded-lg border border-line bg-white shadow-sm"
    >
      <div className="border-b border-line p-5">
        <h2 className="font-semibold">Connections</h2>
        <p className="mt-1 text-sm text-muted">
          Save your account details, test the connection, then enable the
          features you need.
        </p>
      </div>
      <div className="p-5">
        <div className="mb-5 flex flex-wrap gap-2" aria-label="Connection type">
          {views.map((view) => (
            <button
              key={view.group}
              type="button"
              aria-pressed={selected === view.group}
              onClick={() => setSelected(view.group)}
              className={`rounded-md border px-3 py-2 text-sm font-medium ${selected === view.group ? "border-ink bg-ink text-white" : "border-line bg-white hover:bg-panel"}`}
            >
              {connectionDefinitions[view.group].title}
            </button>
          ))}
        </div>
        {views.map((view) => (
          <div key={view.group} hidden={selected !== view.group}>
            <ConnectionForm initial={view} demo={demo} />
          </div>
        ))}
      </div>
    </section>
  );
}

function ConnectionForm({
  initial,
  demo,
}: {
  initial: ConnectionView;
  demo: boolean;
}) {
  const router = useRouter();
  const definition = connectionDefinitions[initial.group];
  const [view, setView] = useState(initial);
  const [values, setValues] = useState<Record<string, string>>({
    ...initial.values,
    [definition.enabledKey]: String(initial.enabled),
  });
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [result, setResult] = useState<ConnectionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const state = dirty
    ? "Unsaved changes"
    : !view.configured
      ? "Not configured"
      : view.check
        ? view.check.ok
          ? "Connection verified"
          : "Connection needs attention"
        : "Configured · not tested";
  function change(key: string, value: string, secret = false) {
    if (secret) setSecrets({ ...secrets, [key]: value });
    else setValues({ ...values, [key]: value });
    setDirty(true);
  }
  function act(operation: "save" | "test" | "notify") {
    const form = new FormData();
    for (const [key, value] of Object.entries({ ...values, ...secrets }))
      form.set(key, value);
    startTransition(async () => {
      const response = await connectionAction(initial.group, operation, form);
      setResult(response);
      if (response.view) {
        setView(response.view);
        if (operation === "save") {
          setValues({
            ...response.view.values,
            [definition.enabledKey]: String(response.view.enabled),
          });
          setSecrets({});
          setDirty(false);
        }
        router.refresh();
      }
    });
  }
  function bridgePreset() {
    const prefix = initial.group === "smtp" ? "SMTP" : "IMAP";
    const next = { ...values };
    for (const [key, value] of Object.entries({
      [`${prefix}_HOST`]: "127.0.0.1",
      [`${prefix}_PORT`]: prefix === "SMTP" ? "1025" : "1143",
      [`${prefix}_SECURITY`]: "starttls",
      [`${prefix}_TLS_VERIFY`]: "false",
    })) {
      if (!view.overridden.includes(key)) next[key] = value;
    }
    setValues(next);
    setDirty(true);
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        act("save");
      }}
      className="space-y-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">{definition.title}</h3>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            {definition.description}
          </p>
        </div>
        <span
          className={`rounded-md px-2 py-1 text-xs font-medium ${view.check?.ok && !dirty ? "bg-emerald-50 text-emerald-800" : "bg-panel text-muted"}`}
        >
          {state}
        </span>
      </div>
      {demo && (
        <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
          Connections stay off in demo mode. Use your ordinary ReachLog session
          to connect an account.
        </p>
      )}
      {result && (
        <p
          role={result.ok ? "status" : "alert"}
          className={`rounded-md p-3 text-sm ${result.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}
        >
          {result.message}
        </p>
      )}
      {view.overridden.length > 0 && (
        <p className="text-sm text-muted">
          Fields marked “From environment” are managed by your environment or
          .env file. Update those there and restart ReachLog.
        </p>
      )}
      {initial.group !== "telegram" && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={pending || demo}
            onClick={bridgePreset}
            className="rounded-md border border-line px-3 py-2 text-sm font-medium disabled:opacity-50"
          >
            Use Proton Bridge defaults
          </button>
          <p className="text-xs text-muted">
            Uses Bridge’s local ports and self-signed certificate. Enter the
            username and password shown in Bridge.
          </p>
        </div>
      )}
      <fieldset
        disabled={pending || demo}
        className="grid min-w-0 gap-4 sm:grid-cols-2"
      >
        <legend className="sr-only">{definition.title} account details</legend>
        {definition.fields.map((field) => {
          const locked = view.overridden.includes(field.key);
          const error = result?.errors?.[field.key];
          const value =
            field.type === "password"
              ? (secrets[field.key] ?? "")
              : (values[field.key] ?? field.defaultValue);
          const common = {
            id: field.key,
            name: field.key,
            disabled: locked,
            "aria-invalid": Boolean(error),
            "aria-describedby": `${field.key}-hint`,
            className:
              "w-full rounded-md border border-line bg-white px-3 py-2 text-sm outline-none focus:border-accent disabled:bg-panel disabled:text-muted",
          };
          return (
            <div
              key={field.key}
              className={
                field.key.endsWith("_MAILBOXES") ? "sm:col-span-2" : ""
              }
            >
              <div className="block">
                {field.type !== "checkbox" && (
                  <label
                    htmlFor={field.key}
                    className="mb-1 block text-sm font-medium"
                  >
                    {field.label}
                    {locked && (
                      <span className="ml-2 text-xs font-normal text-muted">
                        From environment
                      </span>
                    )}
                  </label>
                )}
                {field.type === "select" ? (
                  <select
                    {...common}
                    value={value}
                    onChange={(event) => change(field.key, event.target.value)}
                  >
                    {field.options?.map((option) => (
                      <option key={option} value={option}>
                        {option === "starttls"
                          ? "Require STARTTLS"
                          : option === "tls"
                            ? "TLS from connection start"
                            : option === "auto"
                              ? "Automatic STARTTLS"
                              : "Unencrypted (local relay only)"}
                      </option>
                    ))}
                  </select>
                ) : field.type === "checkbox" ? (
                  <label className="flex items-center gap-2 py-2 text-sm">
                    <input
                      type="checkbox"
                      name={field.key}
                      disabled={locked}
                      checked={value === "true"}
                      onChange={(event) =>
                        change(field.key, String(event.target.checked))
                      }
                      className="size-4 accent-accent"
                    />
                    {field.label}
                    {locked && (
                      <span className="text-xs text-muted">
                        From environment
                      </span>
                    )}
                  </label>
                ) : (
                  <input
                    {...common}
                    type={field.type}
                    value={value}
                    autoComplete={
                      field.type === "password" ? "new-password" : "off"
                    }
                    min={field.type === "number" ? 1 : undefined}
                    max={field.type === "number" ? 65535 : undefined}
                    placeholder={
                      field.type === "password" && view.secrets[field.key]
                        ? "Saved on this machine"
                        : undefined
                    }
                    onChange={(event) =>
                      change(
                        field.key,
                        event.target.value,
                        field.type === "password",
                      )
                    }
                  />
                )}
              </div>
              <p
                id={`${field.key}-hint`}
                className={`mt-1 text-xs ${error ? "text-rose-700" : "text-muted"}`}
              >
                {error || field.hint}
                {field.type === "password" && view.secrets[field.key] && !error
                  ? " A value is already saved."
                  : ""}
              </p>
            </div>
          );
        })}
      </fieldset>
      {initial.group === "imap" && Boolean(view.check?.mailboxes?.length) && (
        <fieldset
          className="rounded-md border border-line p-3"
          disabled={
            pending || demo || view.overridden.includes("IMAP_MAILBOXES")
          }
        >
          <legend className="px-1 text-sm font-medium">
            Available mailboxes
          </legend>
          <div className="flex flex-wrap gap-x-5 gap-y-3">
            {view.check?.mailboxes?.map((mailbox) => (
              <label
                key={mailbox}
                className="flex min-w-0 items-center gap-2 text-sm"
              >
                <input
                  type="checkbox"
                  className="size-4 accent-accent"
                  checked={(values.IMAP_MAILBOXES ?? "")
                    .split(",")
                    .map((value) => value.trim())
                    .includes(mailbox)}
                  onChange={(event) => {
                    const selected = new Set(
                      (values.IMAP_MAILBOXES ?? "")
                        .split(",")
                        .map((value) => value.trim())
                        .filter(Boolean),
                    );
                    if (event.target.checked) selected.add(mailbox);
                    else selected.delete(mailbox);
                    change("IMAP_MAILBOXES", [...selected].join(","));
                  }}
                />
                <span className="break-all">{mailbox}</span>
              </label>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted">
            Save your selection and test again.
          </p>
        </fieldset>
      )}
      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          name={definition.enabledKey}
          type="checkbox"
          checked={values[definition.enabledKey] === "true"}
          disabled={
            pending || demo || view.overridden.includes(definition.enabledKey)
          }
          onChange={(event) =>
            change(definition.enabledKey, String(event.target.checked))
          }
          className="size-4 accent-accent"
        />
        Enable {definition.title.toLowerCase()}
        {view.overridden.includes(definition.enabledKey) && (
          <span className="text-xs font-normal text-muted">
            From environment
          </span>
        )}
      </label>
      <div className="flex flex-wrap gap-3">
        <button
          disabled={pending || demo}
          className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "Working…" : "Save connection"}
        </button>
        <button
          type="button"
          disabled={pending || demo || dirty || !view.configured}
          onClick={() => act("test")}
          className="rounded-md border border-line px-3 py-2 text-sm font-medium disabled:opacity-50"
        >
          Test connection
        </button>
        {initial.group === "telegram" && (
          <button
            type="button"
            disabled={pending || demo || dirty || !view.enabled}
            onClick={() => act("notify")}
            className="rounded-md border border-line px-3 py-2 text-sm font-medium disabled:opacity-50"
          >
            Send test notification
          </button>
        )}
      </div>
      <p className="text-xs text-muted">
        {dirty
          ? "Save changes before testing."
          : "Connection tests do not send email or notifications."}
        {view.check && !dirty && (
          <>
            {" "}
            Last checked:{" "}
            <time dateTime={view.check.checkedAt}>
              {view.check.checkedAt.slice(0, 19).replace("T", " ")} UTC
            </time>
            .
          </>
        )}
      </p>
    </form>
  );
}
