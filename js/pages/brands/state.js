// Global state variables and theme presets
// Extracted from brands.html inline script

let editingBrandId = null;

// Theme presets for different niches
const THEME_PRESETS = {
    // Entertainment
    horror: { primary: '#8B5CF6', secondary: '#1E1E2E', accent: '#EF4444' },
    crime: { primary: '#3B82F6', secondary: '#1A1A2E', accent: '#F59E0B' },
    mystery: { primary: '#10B981', secondary: '#1E1E2E', accent: '#6366F1' },
    scifi: { primary: '#06B6D4', secondary: '#0F172A', accent: '#8B5CF6' },
    gaming: { primary: '#A855F7', secondary: '#1E1E2E', accent: '#EC4899' },
    // Lifestyle
    food: { primary: '#F97316', secondary: '#1C1917', accent: '#FBBF24' },
    fitness: { primary: '#EC4899', secondary: '#1E1E2E', accent: '#F43F5E' },
    travel: { primary: '#0EA5E9', secondary: '#0C4A6E', accent: '#38BDF8' },
    fashion: { primary: '#F472B6', secondary: '#1E1E2E', accent: '#A855F7' },
    diy: { primary: '#F59E0B', secondary: '#1E1E2E', accent: '#84CC16' },
    // Educational
    science: { primary: '#3B82F6', secondary: '#1E293B', accent: '#06B6D4' },
    tech: { primary: '#6366F1', secondary: '#1E1E2E', accent: '#8B5CF6' },
    finance: { primary: '#10B981', secondary: '#1E1E2E', accent: '#047857' },
    history: { primary: '#92400E', secondary: '#1C1917', accent: '#FBBF24' },
    // Automotive
    cars: { primary: '#EF4444', secondary: '#1F2937', accent: '#F97316' },
    motorcycles: { primary: '#F97316', secondary: '#1E1E2E', accent: '#FBBF24' },
    // Other
    pets: { primary: '#F472B6', secondary: '#1E1E2E', accent: '#FB923C' },
    motivation: { primary: '#FBBF24', secondary: '#1E1E2E', accent: '#F59E0B' },
    dark: { primary: '#374151', secondary: '#111827', accent: '#6B7280' },
    other: { primary: '#6366F1', secondary: '#1E1E2E', accent: '#8B5CF6' }
};

