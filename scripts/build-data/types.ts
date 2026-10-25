export interface TableCell {
  span: number;
  html: string;
  text: string;
}

export type Warn = (message: string) => void;
export type CellValue = string | number | boolean | null | undefined;
