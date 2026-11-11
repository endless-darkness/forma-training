export const EXERCISES = [
  { id: 'bench-press', name: 'Barbell bench press', muscle: 'Chest', equipment: 'Barbell', repMin: 6, repMax: 10, targetSets: 3, restSeconds: 180, incrementKg: 2.5 },
  { id: 'incline-dumbbell-press', name: 'Incline dumbbell press', muscle: 'Chest', equipment: 'Dumbbells', repMin: 8, repMax: 12, targetSets: 3, restSeconds: 150, incrementKg: 1 },
  { id: 'chest-supported-row', name: 'Chest-supported row', muscle: 'Back', equipment: 'Machine', repMin: 8, repMax: 12, targetSets: 3, restSeconds: 150, incrementKg: 2.5 },
  { id: 'lat-pulldown', name: 'Lat pulldown', muscle: 'Back', equipment: 'Cable', repMin: 8, repMax: 12, targetSets: 3, restSeconds: 120, incrementKg: 2.5 },
  { id: 'seated-cable-row', name: 'Seated cable row', muscle: 'Back', equipment: 'Cable', repMin: 8, repMax: 12, targetSets: 3, restSeconds: 120, incrementKg: 2.5 },
  { id: 'seated-dumbbell-press', name: 'Seated dumbbell press', muscle: 'Shoulders', equipment: 'Dumbbells', repMin: 8, repMax: 12, targetSets: 3, restSeconds: 150, incrementKg: 1 },
  { id: 'lateral-raise', name: 'Dumbbell lateral raise', muscle: 'Shoulders', equipment: 'Dumbbells', repMin: 12, repMax: 20, targetSets: 3, restSeconds: 90, incrementKg: 1 },
  { id: 'triceps-pressdown', name: 'Cable triceps pressdown', muscle: 'Triceps', equipment: 'Cable', repMin: 10, repMax: 15, targetSets: 3, restSeconds: 90, incrementKg: 2.5 },
  { id: 'dumbbell-curl', name: 'Dumbbell curl', muscle: 'Biceps', equipment: 'Dumbbells', repMin: 10, repMax: 15, targetSets: 3, restSeconds: 90, incrementKg: 1 },
  { id: 'squat', name: 'Barbell squat', muscle: 'Quads', equipment: 'Barbell', repMin: 6, repMax: 10, targetSets: 3, restSeconds: 180, incrementKg: 2.5 },
  { id: 'leg-press', name: 'Leg press', muscle: 'Quads', equipment: 'Machine', repMin: 8, repMax: 12, targetSets: 3, restSeconds: 180, incrementKg: 5 },
  { id: 'leg-extension', name: 'Leg extension', muscle: 'Quads', equipment: 'Machine', repMin: 10, repMax: 15, targetSets: 3, restSeconds: 90, incrementKg: 2.5 },
  { id: 'romanian-deadlift', name: 'Romanian deadlift', muscle: 'Hamstrings', equipment: 'Barbell', repMin: 8, repMax: 12, targetSets: 3, restSeconds: 180, incrementKg: 2.5 },
  { id: 'leg-curl', name: 'Seated leg curl', muscle: 'Hamstrings', equipment: 'Machine', repMin: 10, repMax: 15, targetSets: 3, restSeconds: 120, incrementKg: 2.5 },
  { id: 'hip-thrust', name: 'Barbell hip thrust', muscle: 'Glutes', equipment: 'Barbell', repMin: 8, repMax: 12, targetSets: 3, restSeconds: 150, incrementKg: 2.5 },
  { id: 'calf-raise', name: 'Standing calf raise', muscle: 'Calves', equipment: 'Machine', repMin: 10, repMax: 15, targetSets: 3, restSeconds: 90, incrementKg: 2.5 },
];

// These editable templates are a starting split, not an individualized prescription.
export const TEMPLATES = [
  { id: 'upper-a', name: 'Upper A', subtitle: 'Chest & back', focus: 'Upper body', duration: 55, exerciseIds: ['bench-press', 'chest-supported-row', 'lat-pulldown', 'lateral-raise', 'triceps-pressdown'] },
  { id: 'lower-a', name: 'Lower A', subtitle: 'Quads & hamstrings', focus: 'Lower body', duration: 50, exerciseIds: ['squat', 'romanian-deadlift', 'leg-curl', 'calf-raise'] },
  { id: 'upper-b', name: 'Upper B', subtitle: 'Shoulders & back', focus: 'Upper body', duration: 55, exerciseIds: ['incline-dumbbell-press', 'lat-pulldown', 'seated-dumbbell-press', 'lateral-raise', 'dumbbell-curl'] },
  { id: 'lower-b', name: 'Lower B', subtitle: 'Legs & glutes', focus: 'Lower body', duration: 50, exerciseIds: ['leg-press', 'hip-thrust', 'leg-curl', 'calf-raise'] },
];
