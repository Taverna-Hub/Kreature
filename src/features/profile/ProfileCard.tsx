import { Mascot } from "./Mascot";
import type { ProfileConfig } from "@/features/profile/types";
import { getColor } from "@/features/profile/options";

export function ProfileCard({ config, size = 240 }: { config: ProfileConfig; size?: number }) {
  const color = getColor(config.color);
  return (
    <div
      className="profile-card"
      style={{ backgroundColor: `color-mix(in oklab, ${color.main} 10%, var(--surface))` }}
    >
      <div className="profile-card-mascot">
        <Mascot config={config} size={size} />
      </div>
      <div className="profile-card-copy">
        <h2>@{config.nickname || "seu_apelido"}</h2>
        {config.bio && <p className="profile-card-bio">{config.bio}</p>}
      </div>
    </div>
  );
}
