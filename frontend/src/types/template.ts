export interface TemplateIndexEntry {
  id: string;
  name: string;
  category?: string;
  description?: string;
  tags?: string[];
  thumbnail?: string; // relative path or dataURL
}

export interface TemplateNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: any;
  boxW?: number;
  boxH?: number;
}

export interface TemplateEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  type?: string;
  label?: string;
}

export interface FlowTemplateV1 {
  schemaVersion: 1;
  id: string;
  name: string;
  category?: string;
  description?: string;
  tags?: string[];
  thumbnail?: string;
  nodes: TemplateNode[];
  edges: TemplateEdge[];
}

export type FlowTemplate = FlowTemplateV1; // future-proof
