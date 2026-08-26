import { BellIcon, MagnifyingGlassIcon } from "@heroicons/react/24/outline";

export const Header = () => {
    return (
        <header className="flex justify-between gap-3 py-4 px-4 bg-theme border-neutral-gray w-full">
            <MagnifyingGlassIcon 
                className="absolute h-4 w-4 text-gray-500"
            />
            <input type="text" placeholder="Search trends, authors, topics..." 
            className="
            border-border 
            border 
            text-sm 
            h-10 
            rounded-xl 
            pl-10 
            pr-16 w-[65%] 
            outline-none
            placeholder: text-placeholder-text
            focus:outline-none 
            hover:opacity-80
            focus:ring-2
            focus:ring-primary/40 focus:border-primary/40 transition"/>
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