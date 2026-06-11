import {
  Target, Plane, Home, Car, Smartphone, Gem, GraduationCap, PiggyBank,
  HeartPulse, Palmtree, Gamepad2, BookOpen, ClipboardList, FileText,
  CheckSquare, Lightbulb, Star, Bell, Pin, FolderOpen, Folder, Rocket,
  Briefcase, Trophy, PartyPopper, Bookmark, Paperclip, Puzzle, Notebook,
  Wallet, Banknote, CreditCard, Landmark, TrendingUp, TrendingDown, Coins,
  Percent, Receipt, BarChart3, Dumbbell, Flower2, Salad, Pill, Stethoscope,
  Footprints, Bike, CupSoda, Microscope, Ruler, Calculator, Pencil, Monitor,
  Laptop, ShoppingCart, Pizza, Music, Palette, Sprout, Dog, Users,
} from 'lucide-react';

// Mapa central: id -> componente do ícone
export const ICON_MAP = {
  target: Target, plane: Plane, home: Home, car: Car, smartphone: Smartphone,
  gem: Gem, 'graduation-cap': GraduationCap, 'piggy-bank': PiggyBank,
  'heart-pulse': HeartPulse, palmtree: Palmtree, 'gamepad-2': Gamepad2, 'book-open': BookOpen,
  'clipboard-list': ClipboardList, 'file-text': FileText, 'check-square': CheckSquare,
  lightbulb: Lightbulb, star: Star, bell: Bell, pin: Pin, 'folder-open': FolderOpen,
  folder: Folder, rocket: Rocket, briefcase: Briefcase, trophy: Trophy,
  'party-popper': PartyPopper, bookmark: Bookmark, paperclip: Paperclip, puzzle: Puzzle,
  notebook: Notebook, wallet: Wallet, banknote: Banknote, 'credit-card': CreditCard,
  landmark: Landmark, 'trending-up': TrendingUp, 'trending-down': TrendingDown, coins: Coins,
  percent: Percent, receipt: Receipt, 'bar-chart': BarChart3, dumbbell: Dumbbell,
  flower: Flower2, salad: Salad, pill: Pill, stethoscope: Stethoscope,
  footprints: Footprints, bike: Bike, 'cup-soda': CupSoda, microscope: Microscope,
  ruler: Ruler, calculator: Calculator, pencil: Pencil, monitor: Monitor, laptop: Laptop,
  'shopping-cart': ShoppingCart, pizza: Pizza, music: Music, palette: Palette,
  sprout: Sprout, dog: Dog, users: Users,
};

// Ícones disponíveis para Metas de poupança
export const GOAL_ICONS = [
  'target', 'plane', 'home', 'car', 'smartphone', 'gem',
  'graduation-cap', 'piggy-bank', 'heart-pulse', 'palmtree', 'gamepad-2', 'book-open',
];

// Ícones disponíveis para Listas de Anotações, agrupados por categoria
export const LIST_ICONS = {
  'Geral':    ['clipboard-list', 'file-text', 'check-square', 'target', 'lightbulb', 'star', 'bell', 'pin', 'folder-open', 'folder', 'rocket', 'briefcase', 'bar-chart', 'home', 'notebook', 'paperclip', 'bookmark', 'puzzle', 'party-popper', 'trophy'],
  'Finanças': ['wallet', 'banknote', 'credit-card', 'landmark', 'trending-up', 'trending-down', 'piggy-bank', 'coins', 'percent', 'receipt'],
  'Saúde':    ['dumbbell', 'flower', 'salad', 'pill', 'stethoscope', 'heart-pulse', 'footprints', 'bike', 'cup-soda'],
  'Estudo':   ['graduation-cap', 'book-open', 'pencil', 'microscope', 'monitor', 'laptop', 'ruler', 'calculator'],
  'Vida':     ['plane', 'shopping-cart', 'pizza', 'gamepad-2', 'music', 'palette', 'sprout', 'dog', 'users', 'home'],
};

// Renderiza um ícone pelo id; se não encontrar (ex: emoji antigo), mostra o texto original
export function AppIcon({ id, className, style }) {
  const Icon = ICON_MAP[id];
  if (Icon) return <Icon className={className} style={style} />;
  return <span className={className} style={style}>{id}</span>;
}
