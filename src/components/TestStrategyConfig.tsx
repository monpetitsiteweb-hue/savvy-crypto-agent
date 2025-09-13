import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';

export const TestStrategyConfig = () => {
  const handleClick = () => {
    console.log('BUTTON WORKS!');
  };

  return (
    <div className="p-8 space-y-6">
      <h1 className="text-2xl font-bold text-white">Strategy Config Component</h1>
      
      <div className="space-y-4">
        <Button onClick={handleClick} className="bg-red-500 hover:bg-red-600 text-white">
          <Plus className="w-4 h-4 mr-2" />
          Action Button 1
        </Button>
        
        <Button onClick={handleClick} className="bg-blue-500 hover:bg-blue-600 text-white">
          <Plus className="w-4 h-4 mr-2" />
          Action Button 2
        </Button>
        
        <Button onClick={handleClick} className="bg-green-500 hover:bg-green-600 text-white">
          <Plus className="w-4 h-4 mr-2" />
          Action Button 3
        </Button>
      </div>
    </div>
  );
};