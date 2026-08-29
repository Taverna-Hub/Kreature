import {
  Baby, Banknote, Bike, BookOpen, BriefcaseBusiness, Building2, Bus, Cake, Car, ChartNoAxesCombined,
  CircleEllipsis, Coffee, CreditCard, Dog, Droplet, Dumbbell, Film, Fuel, Gamepad2, Gift,
  GraduationCap, Hammer, HeartPulse, House, Landmark, Laptop, Leaf, Music, Package, PawPrint,
  PiggyBank, Pill, Pizza, Plane, Receipt, Repeat2, RotateCcw, Scissors, Shield, Shirt, ShoppingBag,
  ShoppingCart, Smartphone, Sparkles, Stethoscope, Store, Ticket, TrendingUp, Umbrella, Utensils,
  Wallet, Wifi, Wrench, Zap, type LucideIcon,
} from "lucide-react";

/** Ícones oferecidos ao usuário. A chave é o que fica gravado em `Category.icon`. */
export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  House, Utensils, ShoppingBag, ShoppingCart, Car, Bus, Bike, Fuel, Plane, Ticket,
  HeartPulse, Stethoscope, Pill, Dumbbell, GraduationCap, BookOpen, Laptop, Smartphone, Wifi, Zap,
  Droplet, Building2, Hammer, Wrench, Shield, Umbrella, Baby, PawPrint, Dog, Shirt,
  Scissors, Coffee, Pizza, Cake, Film, Music, Gamepad2, Sparkles, Gift, Leaf,
  Package, Repeat2, CreditCard, Receipt, Banknote, Wallet, PiggyBank, TrendingUp, ChartNoAxesCombined,
  Landmark, Store, BriefcaseBusiness, RotateCcw, CircleEllipsis,
};

/** As categorias padrão nasceram com `Home`, que hoje é apelido de `House`. */
const aliases: Record<string, string> = { Home: "House" };

export const CATEGORY_ICON_NAMES = Object.keys(CATEGORY_ICONS);

export function categoryIcon(name?: string): LucideIcon | undefined {
  if (!name) return undefined;
  return CATEGORY_ICONS[name] ?? CATEGORY_ICONS[aliases[name]];
}
