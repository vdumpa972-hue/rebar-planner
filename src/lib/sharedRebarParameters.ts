export type AppRole = "owner" | "admin" | "user";

export const rebarFirestoreCollections = {
  users: "users",
  trainingRecords: "trainingRecords",
  parameterTemplates: "rebarParameterTemplates",
} as const;

export const appRoleOptions: AppRole[] = ["owner", "admin", "user"];
export const collectorCompatibleRole = "user";

export type SharedParameterField = {
  key: string;
  label: string;
  value: string;
  group: "wall" | "horizontal" | "vertical" | "footing" | "pier" | "callout";
  help: string;
  calculated?: boolean;
  acceptsCropRefs?: boolean;
};

export const sharedParameterFields: SharedParameterField[] = [
  { key: "sideWallLength", label: "Side Wall Length", value: "", group: "wall", acceptsCropRefs: true, help: `Overall long foundation wall length. Example: 52'-0". Used for side wall horizontal rebar runs.` },
  { key: "sideBaseOuterLength", label: "Side Wall Base Outer Required Len (O = side wall + 3 in)", value: "", group: "horizontal", calculated: true, help: `Outer footing/base rebar required length. Formula: side wall + 3 in. Source should be Calc, not PDF.` },
  { key: "sideBaseMiddleLength", label: "Side Wall Base Middle Required Len (M = side wall - 3 in)", value: "", group: "horizontal", calculated: true, help: `Middle footing/base rebar required length. Formula: side wall - 3 in. Source should be Calc, not PDF.` },
  { key: "sideBaseInnerLength", label: "Side Wall Base Inner Required Len (I = side wall - 9 in)", value: "", group: "horizontal", calculated: true, help: `Inner footing/base rebar required length. Formula: side wall - 9 in. Source should be Calc, not PDF.` },
  { key: "endWallLength", label: "End Wall Length", value: "", group: "wall", acceptsCropRefs: true, help: `Foundation end-wall width. Example: 13'-4". Used for end wall horizontal rebar runs.` },
  { key: "endBaseOuterLength", label: "End Wall Base Outer Required Len (O = end wall - 3 in)", value: "", group: "horizontal", calculated: true, help: `Outer end wall footing/base rebar required length. Formula: end wall - 3 in. Source should be Calc, not PDF.` },
  { key: "endBaseMiddleLength", label: "End Wall Base Middle Required Len (M = end wall - 6 in)", value: "", group: "horizontal", calculated: true, help: `Middle end wall footing/base rebar required length. Formula: end wall - 6 in. Source should be Calc, not PDF.` },
  { key: "endBaseInnerLength", label: "End Wall Base Inner Required Len (I = end wall - 9 in)", value: "", group: "horizontal", calculated: true, help: `Inner end wall footing/base rebar required length. Formula: end wall - 9 in. Source should be Calc, not PDF.` },
  { key: "sideAboveGrade", label: "Side Wall Above Grade Height", value: "", group: "wall", help: `Concrete stem wall height visible above finished grade on side walls.` },
  { key: "endAboveGrade", label: "End Wall Above Grade Height", value: "", group: "wall", help: `Concrete stem wall height visible above finished grade on end walls.` },
  { key: "belowGradeEmbed", label: "Below Grade Stem Wall Embed", value: "", group: "wall", help: `Concrete stem wall depth below grade. Used to calculate total concrete wall height.` },
  { key: "sideTotalHeight", label: "Side Wall Total Concrete Height", value: "", group: "wall", calculated: true, help: `Side wall total concrete height = above-grade height + below-grade embed.` },
  { key: "endTotalHeight", label: "End Wall Total Concrete Height", value: "", group: "wall", calculated: true, help: `End wall total concrete height = above-grade height + below-grade embed.` },
  { key: "wallThickness", label: "Wall Thickness", value: "", group: "wall", help: `Concrete stem wall thickness. Example: 6".` },
  { key: "footingDepth", label: "Footing Depth for Vertical Bars", value: "", group: "footing", help: `Footing depth used in vertical bar calculations. Example: 18".` },
  { key: "sideVerticalQty", label: "Side Wall Vertical Bar Qty (V-S)", value: "", group: "vertical", help: `Total quantity of V-S vertical bars on both side walls. Verify against the plan.` },
  { key: "sideVerticalBottomClearance", label: "Side Wall Vertical Bottom Clearance", value: "", group: "vertical", help: `Clearance from footing bottom to start of side vertical bar. Commonly 3 in, but Live Mode requires PDF/user value.` },
  { key: "sideVerticalTopClearance", label: "Side Wall Vertical Top Clearance", value: "", group: "vertical", help: `Clearance from top of side wall to top of vertical bar. Used around vent/opening areas.` },
  { key: "sideVerticalUsedHeight", label: "Side Wall Vertical Used Height Override (optional)", value: "", group: "vertical", help: `Optional override. Leave blank for automatic calculation from total height minus top/bottom clearance.` },
  { key: "endVerticalQty", label: "End Wall Vertical Bar Qty (V-E)", value: "", group: "vertical", help: `Total quantity of V-E vertical bars on both end walls. Verify against the plan.` },
  { key: "endVerticalBottomClearance", label: "End Wall Vertical Bottom Clearance", value: "", group: "vertical", help: `Clearance from footing bottom to start of end vertical bar. Commonly 3 in, but Live Mode requires PDF/user value.` },
  { key: "endVerticalTopClearance", label: "End Wall Vertical Top Clearance", value: "", group: "vertical", help: `Clearance from top of end wall to top of vertical bar.` },
  { key: "endVerticalUsedHeight", label: "End Wall Vertical Used Height Override (optional)", value: "", group: "vertical", help: `Optional override. Leave blank for automatic calculation from total height minus top/bottom clearance.` },
  { key: "baseShortVerticalQty", label: "FOOTING_TIE_BAR Qty", value: "", group: "footing", calculated: true, help: `Quantity of FOOTING_TIE_BAR pieces at 1 ft separation around the footing perimeter. Formula: ceil(2 × side wall length + 2 × end wall length).` },
  { key: "baseShortVerticalCutLength", label: "FOOTING_TIE_BAR Cut Length", value: "", group: "footing", help: `Cut length for each FOOTING_TIE_BAR piece. Live Mode requires PDF/user value.` },
  { key: "footingSize", label: "Footing Size", value: "", group: "footing", help: `Footing size callout from plan. Example: 18" x 18".` },
  { key: "ptSillPlates", label: "PT Sill Plates", value: "", group: "footing", help: `Pressure-treated sill plates sitting on the concrete stem wall. Used when deriving concrete height from beam/grade dimensions.` },
  { key: "pierCount", label: "Pier Count", value: "", group: "pier", acceptsCropRefs: true, help: `Total number of pier cages/support piers. Verify against plan marks.` },
  { key: "pierDiameter", label: "Pier Diameter", value: "", group: "pier", acceptsCropRefs: true, help: `Pier/sonotube diameter. Example: 28".` },
  { key: "pierHeight", label: "Pier Height / Cage Height", value: "", group: "pier", acceptsCropRefs: true, help: `Pier concrete height or cage height to use for pier cage planning. Example: 30" or 2'-6". Enter from plan or field measurement.` },
  { key: "rebarCallouts", label: "Rebar Callout Description", value: "", group: "callout", acceptsCropRefs: true, help: `Plan rebar specification/callout description found on the plan, such as #4, V-E, V-S, pier cages, or spacing.` },
];

export const initialFields = sharedParameterFields.map(({ key, label, value }) => ({ key, label, value }));
export const fieldHelp = Object.fromEntries(sharedParameterFields.map((field) => [field.key, field.help]));
export const calculatedFieldKeys = new Set(sharedParameterFields.filter((field) => field.calculated).map((field) => field.key));
