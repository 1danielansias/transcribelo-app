import React from "react";

export default function Header() {
  return (
    <header className="flex items-center justify-between gap-4 p-4">
      <h1 className="font-medium">
        Free<span className="text-blue-400 bold">Scribe</span>
      </h1>
      <button className="flex items-center gap-2 specialBtn px-4 py-2 rounded-lg text-blue-400">
        <p>Nuevo</p>
        <i className="fa-solid fa-plus"></i>
      </button>
    </header>
  );
}