"use client";

import * as React from "react";

type OrgDbContextValue = {
  db: any | null;
};

const OrgDbContext = React.createContext<OrgDbContextValue | null>(null);

export function OrgDbProvider({
  db,
  children,
}: {
  db: any | null;
  children: React.ReactNode;
}) {
  return <OrgDbContext.Provider value={{ db }}>{children}</OrgDbContext.Provider>;
}

export function useOrgDb(): OrgDbContextValue {
  const context = React.useContext(OrgDbContext);
  if (!context) {
    throw new Error("useOrgDb must be used within OrgDbProvider");
  }
  return context;
}
