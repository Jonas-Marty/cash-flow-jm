import {
  Wallet, Landmark, PiggyBank, CreditCard, Banknote, Coins, Building2, Receipt,
  ShoppingCart, ShoppingBag, Utensils, Coffee, Pizza, Wine, Beer, IceCream,
  Car, Bus, Train, Plane, Bike, Fuel, ParkingCircle, TramFront,
  Home, Lightbulb, Wifi, Phone, Tv, Wrench, Hammer, Trash2,
  Heart, Stethoscope, Pill, Dumbbell, Activity, Cross,
  Gift, PartyPopper, Music, Film, Gamepad2, BookOpen, Camera, Palette,
  Briefcase, GraduationCap, Baby, Cat, Dog, Sprout, TreePine, Sun,
  Smartphone, Laptop, Monitor, Headphones, Shirt, Footprints, Glasses,
  Globe, MapPin, Sparkles, Star, Tag, Wand2, Zap, Flame, Snowflake,
  Hotel, Bed, Bath, ChefHat, Soup, Apple, Carrot, Cookie,
  HeartPulse, Mail, Truck, Package, Warehouse, Factory, ShieldCheck,
  type LucideIcon,
} from "lucide-react";

const ICON_MAP: Record<string, LucideIcon> = {
  wallet: Wallet, landmark: Landmark, "piggy-bank": PiggyBank, "credit-card": CreditCard,
  banknote: Banknote, coins: Coins, building: Building2, receipt: Receipt,
  "shopping-cart": ShoppingCart, "shopping-bag": ShoppingBag, utensils: Utensils,
  coffee: Coffee, pizza: Pizza, wine: Wine, beer: Beer, "ice-cream": IceCream,
  car: Car, bus: Bus, train: Train, plane: Plane, bike: Bike, fuel: Fuel,
  parking: ParkingCircle, tram: TramFront,
  home: Home, lightbulb: Lightbulb, wifi: Wifi, phone: Phone, tv: Tv,
  wrench: Wrench, hammer: Hammer, trash: Trash2,
  heart: Heart, stethoscope: Stethoscope, pill: Pill, dumbbell: Dumbbell,
  activity: Activity, cross: Cross,
  gift: Gift, party: PartyPopper, music: Music, film: Film, game: Gamepad2,
  book: BookOpen, camera: Camera, palette: Palette,
  briefcase: Briefcase, school: GraduationCap, baby: Baby, cat: Cat, dog: Dog,
  sprout: Sprout, tree: TreePine, sun: Sun,
  smartphone: Smartphone, laptop: Laptop, monitor: Monitor, headphones: Headphones,
  shirt: Shirt, footprints: Footprints, glasses: Glasses,
  globe: Globe, "map-pin": MapPin, sparkles: Sparkles, star: Star, tag: Tag,
  wand: Wand2, zap: Zap, flame: Flame, snowflake: Snowflake,
  hotel: Hotel, bed: Bed, bath: Bath, "chef-hat": ChefHat, soup: Soup,
  apple: Apple, carrot: Carrot, cookie: Cookie,
  "heart-pulse": HeartPulse, mail: Mail, truck: Truck, package: Package,
  warehouse: Warehouse, factory: Factory, shield: ShieldCheck,
};

export const ICON_GROUPS: { label: string; names: string[] }[] = [
  { label: "Money", names: ["wallet", "landmark", "piggy-bank", "credit-card", "banknote", "coins", "building", "receipt"] },
  { label: "Food", names: ["shopping-cart", "shopping-bag", "utensils", "coffee", "pizza", "wine", "beer", "ice-cream", "chef-hat", "soup", "apple", "carrot", "cookie"] },
  { label: "Transport", names: ["car", "bus", "train", "plane", "bike", "fuel", "parking", "tram", "truck"] },
  { label: "Home", names: ["home", "lightbulb", "wifi", "phone", "tv", "wrench", "hammer", "trash", "bed", "bath"] },
  { label: "Health", names: ["heart", "stethoscope", "pill", "dumbbell", "activity", "cross", "heart-pulse"] },
  { label: "Leisure", names: ["gift", "party", "music", "film", "game", "book", "camera", "palette", "hotel"] },
  { label: "Life", names: ["briefcase", "school", "baby", "cat", "dog", "sprout", "tree", "sun", "shirt", "footprints", "glasses"] },
  { label: "Tech", names: ["smartphone", "laptop", "monitor", "headphones"] },
  { label: "Other", names: ["globe", "map-pin", "sparkles", "star", "tag", "wand", "zap", "flame", "snowflake", "mail", "package", "warehouse", "factory", "shield"] },
];

export const ALL_ICON_NAMES = Object.keys(ICON_MAP);

export function getIcon(name?: string | null): LucideIcon {
  if (!name) return Wallet;
  return ICON_MAP[name] ?? Wallet;
}
