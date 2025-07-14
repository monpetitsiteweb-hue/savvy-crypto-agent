export const Footer = () => {
  return (
    <footer className="bg-slate-800/50 border-t border-slate-700 py-6 mt-auto">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-center gap-3">
          <span className="text-slate-400 text-sm">Powered by</span>
          <div className="flex items-center gap-2">
            <img 
              src="/lovable-uploads/5529a717-836d-40a1-9911-41ad294f263d.png" 
              alt="Mon Petit Site Web" 
              className="w-6 h-6"
            />
            <span className="text-white font-medium text-sm">Mon Petit Site Web</span>
          </div>
        </div>
      </div>
    </footer>
  );
};