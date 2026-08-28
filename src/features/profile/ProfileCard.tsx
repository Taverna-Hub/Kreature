import { Mascot } from "./Mascot";
import type { ProfileConfig } from "@/features/profile/types";
import { getColor } from "@/features/profile/options";

const frameStyles: Record<ProfileConfig["frame"], { label: string | null }> = {
  none: { label: null },
  gold: { label: "Lendário" },
  neon: { label: "Nível 42 mítico" },
  pixel: { label: "Pixel perfeito" },
  star: { label: "Estrela" },
  rainbow: { label: "Arco-íris" },
  checker: { label: "Xadrez" },
  bubble: { label: "Bolha" },
  stitched: { label: "Costurada" },
};

export function ProfileCard({ config, size = 240 }: { config: ProfileConfig; size?: number }) {
  const color = getColor(config.color);
  const frame = frameStyles[config.frame];
  return (
    <div
      className={`profile-card profile-frame-${config.frame}`}
      style={{ backgroundColor: `color-mix(in oklab, ${color.main} 10%, var(--surface))` }}
    >
      <div className="profile-card-mascot">
        <Mascot config={config} size={size} />
      </div>
      <div className="profile-card-copy">
        {frame.label && <div className="profile-frame-label">{frame.label}</div>}
        <h2>@{config.nickname || "seu_apelido"}</h2>
        {config.title && <p className="profile-card-title">{config.title}</p>}
        {config.bio && <p className="profile-card-bio">{config.bio}</p>}
      </div>
    </div>
  );
}
