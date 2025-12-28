import React from "react";
import { useAuth } from "../lib/hooks/useAuth";
import { Button } from "./ui/button";

export default function LogoutButton() {
  const { logout, isAuthenticated } = useAuth();

  // Don't render if not authenticated
  if (!isAuthenticated) {
    return null;
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={logout}
      className="text-muted-foreground hover:text-foreground"
      title="Wyloguj"
    >
      <svg className="h-4 w-4 sm:mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
        />
      </svg>
      <span className="hidden sm:inline">Wyloguj</span>
    </Button>
  );
}
