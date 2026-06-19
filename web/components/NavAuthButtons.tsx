"use client";

import Link from "next/link";
import { useUser, SignInButton, UserButton } from "@clerk/nextjs";

export default function NavAuthButtons() {
  const { isSignedIn, isLoaded } = useUser();

  if (!isLoaded) return null;

  if (isSignedIn) {
    return (
      <>
        <Link href="/dashboard" className="text-sm text-gray-400 hover:text-white transition-colors">
          Dashboard
        </Link>
        <UserButton
          appearance={{
            elements: { avatarBox: "w-7 h-7" },
          }}
        />
      </>
    );
  }

  return (
    <SignInButton mode="modal">
      <button className="text-sm text-gray-400 hover:text-white transition-colors">
        Sign in
      </button>
    </SignInButton>
  );
}
