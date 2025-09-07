describe('Past Positions - Exact DB Values', () => {
  beforeEach(() => {
    // Login as test user
    cy.visit('/auth');
    cy.get('[data-testid="email"]').type('test@example.com');
    cy.get('[data-testid="password"]').type('password');
    cy.get('[data-testid="sign-in"]').click();
    cy.url().should('include', '/');
    
    // Navigate to trading history
    cy.get('[data-testid="nav-trading-history"]').click();
    cy.get('[data-testid="past-positions-tab"]').click();
  });

  it('displays exact purchase prices, exit prices, and P&L from database', () => {
    // Wait for past positions to load
    cy.get('[data-testid="past-positions-list"]').should('be.visible');
    
    // Test the three specific cases from the DB query
    const testCases = [
      { purchase: '94,916.44', exit: '94,879.97', pnl: '−0.02' },
      { purchase: '94,925.62', exit: '94,901.84', pnl: '−0.01' },
      { purchase: '94,981.81', exit: '94,899.35', pnl: '−0.04' }
    ];
    
    testCases.forEach((testCase, index) => {
      cy.get('[data-testid="past-position-card"]').eq(index).within(() => {
        // Purchase Price should show the BUY price
        cy.get('[data-testid="purchase-price"]')
          .should('contain', `€${testCase.purchase}`);
        
        // Exit Price should show the SELL price  
        cy.get('[data-testid="exit-price"]')
          .should('contain', `€${testCase.exit}`);
        
        // P&L should show the realized P&L from DB
        cy.get('[data-testid="realized-pnl"]')
          .should('contain', `€${testCase.pnl}`);
        
        // Verify purchase and exit prices are different
        cy.get('[data-testid="purchase-price"]').invoke('text').then((purchaseText) => {
          cy.get('[data-testid="exit-price"]').invoke('text').then((exitText) => {
            expect(purchaseText).to.not.equal(exitText);
          });
        });
      });
    });
  });

  it('shows distinct purchase and exit prices for all closed positions', () => {
    cy.get('[data-testid="past-positions-list"]').should('be.visible');
    
    // Check that no closed position shows identical purchase and exit prices
    cy.get('[data-testid="past-position-card"]').each(($card) => {
      cy.wrap($card).within(() => {
        cy.get('[data-testid="purchase-price"]').invoke('text').then((purchaseText) => {
          cy.get('[data-testid="exit-price"]').invoke('text').then((exitText) => {
            // They should be different (not identical due to fallback bug)
            expect(purchaseText).to.not.equal(exitText);
          });
        });
      });
    });
  });
});