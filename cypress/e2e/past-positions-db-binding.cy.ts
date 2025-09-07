describe('Past Positions DB Binding', () => {
  beforeEach(() => {
    cy.visit('/');
    cy.mockAuthenticatedUser();
  });

  it('should display exact DB values for past positions', () => {
    // Mock specific trade data with different buy and sell prices
    const mockPastTrade = {
      id: 'test-trade-1',
      trade_type: 'sell',
      cryptocurrency: 'BTC',
      amount: 0.0005268601746815447,
      price: 94899.35, // Sell price
      total_value: 50.00,
      executed_at: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
      original_purchase_price: 94981.81, // Buy price (different from sell)
      original_purchase_amount: 0.0005268601746815447,
      original_purchase_value: 50.04,
      exit_value: 50.00,
      realized_pnl: -0.04,
      realized_pnl_pct: -0.08,
      is_test_mode: true,
      user_id: 'test-user-id'
    };

    // Intercept the trading history API call
    cy.intercept('POST', '**/rest/v1/mock_trades*', {
      statusCode: 200,
      body: { data: [mockPastTrade] }
    }).as('getMockTrades');

    // Navigate to trading history
    cy.get('[data-testid="trading-history"]').should('be.visible');
    
    // Switch to Past Positions tab
    cy.contains('Past Positions').click();
    
    // Wait for data to load
    cy.wait('@getMockTrades');
    
    // Verify the purchase price shows the original purchase price from DB
    cy.contains('Purchase Price').parent().should('contain', '€94 981,81');
    
    // Verify the exit price shows the actual sell price from DB
    cy.contains('Exit Price').parent().should('contain', '€94 899,35');
    
    // Verify realized P&L shows the exact DB value
    cy.contains('P&L (€)').parent().should('contain', '-€0,04');
    
    // Verify that purchase and exit prices are visibly different
    cy.contains('Purchase Price').parent().should('not.contain', '€94 899,35');
    cy.contains('Exit Price').parent().should('not.contain', '€94 981,81');
  });

  it('should handle missing realized_pnl gracefully', () => {
    const mockTradeWithoutPnL = {
      id: 'test-trade-2',
      trade_type: 'sell',
      cryptocurrency: 'ETH',
      amount: 0.02,
      price: 2500.00,
      total_value: 50.00,
      executed_at: new Date(Date.now() - 1000 * 60 * 10).toISOString(),
      original_purchase_price: 2520.00,
      original_purchase_amount: 0.02,
      original_purchase_value: 50.40,
      exit_value: 50.00,
      realized_pnl: null, // Missing P&L
      realized_pnl_pct: null,
      is_test_mode: true,
      user_id: 'test-user-id'
    };

    cy.intercept('POST', '**/rest/v1/mock_trades*', {
      statusCode: 200,
      body: { data: [mockTradeWithoutPnL] }
    }).as('getMockTradesNoPnL');

    cy.contains('Past Positions').click();
    cy.wait('@getMockTradesNoPnL');
    
    // Should show €0.00 when realized_pnl is null
    cy.contains('P&L (€)').parent().should('contain', '€0,00');
  });
});