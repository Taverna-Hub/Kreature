export type BodyShape =
  "round" | "tall" | "short" | "blob" | "bean" | "star" | "egg" | "diamond" | "heart";
export type ColorTheme =
  | "orange"
  | "teal"
  | "pink"
  | "violet"
  | "lime"
  | "sky"
  | "midnight"
  | "sunset"
  | "mint"
  | "rose"
  | "gold"
  | "navy"
  | "lavender"
  | "coral";
export type Expression =
  | "happy"
  | "excited"
  | "calm"
  | "surprised"
  | "smug"
  | "sleepy"
  | "love"
  | "wink"
  | "cool"
  | "angry"
  | "sad"
  | "tongue"
  | "dizzy";
export type Accessory =
  | "glasses"
  | "cap"
  | "headphones"
  | "backpack"
  | "scarf"
  | "crown"
  | "halo"
  | "bowtie"
  | "mustache"
  | "earrings"
  | "flower"
  | "antenna"
  | "monocle"
  | "beard"
  | "partyhat"
  | "eyepatch"
  | "beanie"
  | "tie";
export type Frame =
  "none" | "gold" | "neon" | "pixel" | "star" | "rainbow" | "checker" | "bubble" | "stitched";
export type Background =
  | "gradient"
  | "bubbles"
  | "waves"
  | "grid"
  | "confetti"
  | "stars"
  | "stripes"
  | "rays"
  | "plain"
  | "dots"
  | "hearts"
  | "sparkles";

export interface ProfileConfig {
  body: BodyShape;
  color: ColorTheme;
  expression: Expression;
  accessories: Accessory[];
  frame: Frame;
  background: Background;
  nickname: string;
  title: string;
  bio: string;
}

export const DEFAULT_PROFILE: ProfileConfig = {
  body: "round",
  color: "orange",
  expression: "happy",
  accessories: ["headphones"],
  frame: "neon",
  background: "gradient",
  nickname: "PixelBuddy",
  title: "Mythic Dreamer",
  bio: "Lover of digital artifacts and high-contrast dreams. Exploring the neon frontier one pixel at a time.",
};
