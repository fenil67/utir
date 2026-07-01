"use client";

import Link from "next/link";
import { useUser, SignInButton, UserButton } from "@clerk/nextjs";
import { useEffect, useState } from "react";

export default function NavAuthButtons() {
  const { user, isSignedIn, isLoaded } = useUser();
  const [isOwner, setIsOwner] = useState(false);

  useEffect(() => {
    const ownerId = process.env.NEXT_PUBLIC_OWNER_CLERK_ID;
    setIsOwner(!!ownerId && user?.id === ownerId);
  }, [user]);

  if (!isLoaded) return null;

  if (isSignedIn) {
    return (
      <>
        {isOwner && (
          <Link href="/admin" className="text-sm text-gray-400 hover:text-white transition-colors">
            Admin
          </Link>
        )}
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
