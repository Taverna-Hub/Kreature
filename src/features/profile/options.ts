import type { Accessory, Background, BodyShape, ColorTheme, Expression } from "./types";

export const BODY_OPTIONS: { id: BodyShape; label: string }[] = [
  { id: "round", label: "Redondinho" },
  { id: "tall", label: "Alto" },
  { id: "short", label: "Baixinho" },
  { id: "blob", label: "Geleia" },
  { id: "bean", label: "Feijão" },
  { id: "star", label: "Estrela" },
  { id: "egg", label: "Ovinho" },
  { id: "diamond", label: "Diamante" },
  { id: "heart", label: "Coração" },
];

export const COLOR_OPTIONS: {
  id: ColorTheme;
  label: string;
  main: string;
  shade: string;
}[] = [
  { id: "orange", label: "Tangerina", main: "#f97316", shade: "#c2410c" },
  { id: "teal", label: "Lagoa", main: "#0d9488", shade: "#0f766e" },
  { id: "pink", label: "Chiclete", main: "#ec4899", shade: "#be185d" },
  { id: "violet", label: "Galáxia", main: "#8b5cf6", shade: "#6d28d9" },
  { id: "lime", label: "Limão", main: "#84cc16", shade: "#4d7c0f" },
  { id: "sky", label: "Céu", main: "#0ea5e9", shade: "#0369a1" },
  { id: "midnight", label: "Meia-noite", main: "#1e293b", shade: "#0f172a" },
  { id: "sunset", label: "Pôr do sol", main: "#ef4444", shade: "#b91c1c" },
  { id: "mint", label: "Menta", main: "#34d399", shade: "#059669" },
  { id: "rose", label: "Rosa", main: "#f43f5e", shade: "#9f1239" },
  { id: "gold", label: "Ouro", main: "#eab308", shade: "#a16207" },
  { id: "navy", label: "Marinho", main: "#1e40af", shade: "#1e3a8a" },
  { id: "lavender", label: "Lavanda", main: "#c4b5fd", shade: "#8b5cf6" },
  { id: "coral", label: "Coral", main: "#fb7185", shade: "#e11d48" },
];

export const EXPRESSION_OPTIONS: { id: Expression; label: string }[] = [
  { id: "happy", label: "Feliz" },
  { id: "excited", label: "Animado" },
  { id: "calm", label: "Calmo" },
  { id: "surprised", label: "Surpreso" },
  { id: "smug", label: "Esperto" },
  { id: "sleepy", label: "Sonolento" },
  { id: "love", label: "Apaixonado" },
  { id: "wink", label: "Piscadinha" },
  { id: "cool", label: "Estiloso" },
  { id: "angry", label: "Bravinho" },
  { id: "sad", label: "Tristinho" },
  { id: "tongue", label: "Língua" },
  { id: "dizzy", label: "Tonto" },
];

export const ACCESSORY_OPTIONS: { id: Accessory; label: string }[] = [
  { id: "glasses", label: "Óculos" },
  { id: "cap", label: "Boné" },
  { id: "headphones", label: "Fone" },
  { id: "beanie", label: "Gorro" },
  { id: "crown", label: "Coroa" },
  { id: "halo", label: "Auréola" },
  { id: "partyhat", label: "Chapéu de festa" },
  { id: "antenna", label: "Antena" },
  { id: "flower", label: "Florzinha" },
  { id: "bowtie", label: "Gravatinha" },
  { id: "tie", label: "Gravata" },
  { id: "mustache", label: "Bigode" },
  { id: "beard", label: "Barba" },
  { id: "monocle", label: "Monóculo" },
  { id: "eyepatch", label: "Tapa-olho" },
  { id: "earrings", label: "Brincos" },
  { id: "scarf", label: "Cachecol" },
  { id: "backpack", label: "Mochila" },
];

export const BACKGROUND_OPTIONS: { id: Background; label: string }[] = [
  { id: "gradient", label: "Gradiente" },
  { id: "bubbles", label: "Bolhas" },
  { id: "waves", label: "Ondas" },
  { id: "grid", label: "Grade" },
  { id: "confetti", label: "Confete" },
  { id: "stars", label: "Estrelas" },
  { id: "stripes", label: "Listras" },
  { id: "rays", label: "Raios" },
  { id: "dots", label: "Poá" },
  { id: "hearts", label: "Corações" },
  { id: "sparkles", label: "Brilhos" },
  { id: "plain", label: "Liso" },
];

export const CATEGORIES = [
  { id: "body", label: "Estilo" },
  { id: "color", label: "Cor" },
  { id: "expression", label: "Rosto" },
  { id: "accessories", label: "Acessórios" },
  { id: "background", label: "Fundo" },
  { id: "identity", label: "Identidade" },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]["id"];

export function getColor(id: ColorTheme) {
  return COLOR_OPTIONS.find((c) => c.id === id) ?? COLOR_OPTIONS[0];
}
