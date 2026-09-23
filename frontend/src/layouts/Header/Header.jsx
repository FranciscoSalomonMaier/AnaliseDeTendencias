import { BellIcon, MagnifyingGlassIcon } from "@heroicons/react/24/outline";

export const Header = () => {
    return (
        <header className="flex justify-between gap-3 py-4 px-4 bg-theme border-neutral-gray w-full">
            <div className="relative w-[65%]">
                <MagnifyingGlassIcon
                    aria-hidden="true"
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500"
                />
                <input type="text" placeholder="Search trends, authors, topics..."
                className="
                border-border
                border
                text-sm
                h-10
                w-full
                rounded-xl
                pl-10
                pr-16
                outline-none
                placeholder:text-placeholder-text
                focus:outline-none
                hover:opacity-80
                focus:ring-2
                focus:ring-primary/40 focus:border-primary/40 transition"/>
            </div>
            <div className="flex items-center gap-4">
                <button className="rounded-full h-9 w-9 bg-light-gray cursor-pointer place-items-center border-neutral-gray hover:opacity-80">
                    <BellIcon className="w-6 h-6 text-gray-700"/>
                </button>
                <button className="rounded-full h-9 w-9 cursor-pointer text-white place-items-center font-bold gradient-primary">
                    FM
                </button>
            </div>
        </header>
    );
}