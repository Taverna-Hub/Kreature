import { useEffect, useId, useState, type ReactNode } from "react";
import { Mascot } from "./Mascot";
import { ProfileCard } from "./ProfileCard";
import type { Accessory, ProfileConfig } from "./types";
import { Button } from "@/shared/ui/Button";
import { Dialog } from "@/shared/ui/Dialog";
import {
  ACCESSORY_OPTIONS, BACKGROUND_OPTIONS, BODY_OPTIONS, CATEGORIES, COLOR_OPTIONS,
  EXPRESSION_OPTIONS, type CategoryId,
} from "./options";

export function CharacterCustomizer({ value, onSave, onCancel }: {
  value: ProfileConfig;
  onSave: (value: ProfileConfig) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const [active, setActive] = useState<CategoryId>("body");
  const [saving, setSaving] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const tabId = useId();
  const dirty = JSON.stringify(draft) !== JSON.stringify(value);
  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    const listener = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    window.addEventListener("beforeunload", listener);
    return () => window.removeEventListener("beforeunload", listener);
  }, [dirty]);
  const update = <K extends keyof ProfileConfig>(key: K, next: ProfileConfig[K]) =>
    setDraft((current) => ({ ...current, [key]: next }));
  const toggleAccessory = (accessory: Accessory) => setDraft((current) =>
    current.accessories.includes(accessory)
      ? { ...current, accessories: current.accessories.filter((item) => item !== accessory) }
      : current.accessories.length >= 3 ? current : { ...current, accessories: [...current.accessories, accessory] },
  );
  const save = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    try { await onSave(draft); } finally { setSaving(false); }
  };
  const cancel = () => {
    if (!dirty) {
      setDraft(value);
      onCancel();
      return;
    }
    setDiscarding(true);
  };
  return (
    <>
      <section className="customizer" aria-label="Editor do personagem">
        <aside className="preview">
          <ProfileCard config={draft} size={280} />
        </aside>
        <section className="customizer-controls">
        <div className="tabs" role="tablist" aria-label="Partes do personagem">
          {CATEGORIES.map((item) => (
            <button type="button" role="tab" id={`${tabId}-${item.id}-tab`} aria-controls={`${tabId}-${item.id}-panel`}
              aria-selected={active === item.id} tabIndex={active === item.id ? 0 : -1}
              className={active === item.id ? "active" : ""} onClick={() => setActive(item.id)} key={item.id}>{item.label}</button>
          ))}
        </div>
        <div id={`${tabId}-${active}-panel`} role="tabpanel" aria-labelledby={`${tabId}-${active}-tab`}>
          <OptionPanel active={active} config={draft} update={update} toggleAccessory={toggleAccessory} />
        </div>
          <div className="form-actions">
            <Button variant="secondary" type="button" disabled={saving} onClick={cancel}>Cancelar</Button>
            <Button type="button" disabled={!dirty || saving} onClick={() => void save()}>{saving ? "Salvando…" : "Salvar alterações"}</Button>
          </div>
        </section>
      </section>
      {discarding ? <Dialog title="Descartar alterações" onClose={() => setDiscarding(false)}><p>Descartar as alterações não salvas do personagem?</p><div className="form-actions"><Button type="button" variant="secondary" onClick={() => setDiscarding(false)}>Continuar editando</Button><Button type="button" variant="danger" onClick={() => { setDraft(value); setDiscarding(false); onCancel(); }}>Descartar alterações</Button></div></Dialog> : null}
    </>
  );
}

function ProfileField({ label, children, full = false }: { label: string; children: ReactNode; full?: boolean }) {
  return <label className={`profile-field${full ? " full" : ""}`}><span>{label}</span>{children}</label>;
}

function Choice({ label, selected, children, onClick, disabled }: {
  label: string; selected: boolean; children: ReactNode; onClick: () => void; disabled?: boolean;
}) {
  return <button type="button" className={`choice ${selected ? "selected" : ""}`} aria-pressed={selected}
    disabled={disabled} onClick={onClick}>{children}<span>{label}</span></button>;
}

function OptionPanel({ active, config, update, toggleAccessory }: {
  active: CategoryId; config: ProfileConfig;
  update: <K extends keyof ProfileConfig>(key: K, value: ProfileConfig[K]) => void;
  toggleAccessory: (value: Accessory) => void;
}) {
  const sample = (patch: Partial<ProfileConfig>) => {
    const sampleConfig: ProfileConfig = { ...config, accessories: [], frame: "none", background: "plain", nickname: "", title: "", bio: "", ...patch };
    return <div className="mascot-sample"><Mascot config={sampleConfig} size={56} animated={false} /></div>;
  };
  if (active === "identity") return (
    <div className="profile-fields">
      <ProfileField label="Apelido"><input maxLength={24} value={config.nickname} onChange={(event) => update("nickname", event.target.value)} /></ProfileField>
      <ProfileField label="Título"><input maxLength={60} value={config.title} onChange={(event) => update("title", event.target.value)} /></ProfileField>
      <ProfileField full label="Bio"><textarea maxLength={180} rows={4} value={config.bio} onChange={(event) => update("bio", event.target.value)} /></ProfileField>
    </div>
  );
  if (active === "color") return <div className="choices colors">{COLOR_OPTIONS.map((item) => <Choice key={item.id} label={item.label} selected={config.color === item.id} onClick={() => update("color", item.id)}><i style={{ background: `linear-gradient(135deg,${item.main},${item.shade})` }} /></Choice>)}</div>;
  const options = active === "body" ? BODY_OPTIONS : active === "expression" ? EXPRESSION_OPTIONS : active === "accessories" ? ACCESSORY_OPTIONS : BACKGROUND_OPTIONS;
  return <div className="choices">{options.map((item) => {
    const selected = active === "accessories" ? config.accessories.includes(item.id as Accessory) : config[active] === item.id;
    const disabled = active === "accessories" && config.accessories.length >= 3 && !selected;
    const patch = active === "accessories" ? { accessories: [item.id as Accessory] } : ({ [active]: item.id } as Partial<ProfileConfig>);
    return <Choice key={item.id} label={item.label} selected={selected} disabled={disabled} onClick={() => active === "accessories" ? toggleAccessory(item.id as Accessory) : update(active, item.id as never)}>{sample(patch)}</Choice>;
  })}</div>;
}
