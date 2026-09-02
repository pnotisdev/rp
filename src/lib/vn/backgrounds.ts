export interface BackgroundOption {
  id: string
  label: string
}

/** Default scene locations offered to every world so the LLM has somewhere to place the moment even with no custom art uploaded. */
export const DEFAULT_BACKGROUNDS: BackgroundOption[] = [
  { id: 'bedroom', label: 'Bedroom' },
  { id: 'living-room', label: 'Living room' },
  { id: 'kitchen', label: 'Kitchen' },
  { id: 'cafe', label: 'Café' },
  { id: 'classroom', label: 'Classroom' },
  { id: 'school-hallway', label: 'School hallway' },
  { id: 'park', label: 'Park' },
  { id: 'city-street', label: 'City street' },
  { id: 'beach', label: 'Beach' },
  { id: 'forest', label: 'Forest' },
  { id: 'rooftop', label: 'Rooftop' },
  { id: 'office', label: 'Office' },
]

export const DEFAULT_BACKGROUND_IDS = DEFAULT_BACKGROUNDS.map((b) => b.id)
