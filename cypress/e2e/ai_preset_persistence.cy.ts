describe('AI Preset Persistence', () => {
  beforeEach(() => {
    // Mock authentication and navigate to strategy page
    cy.visit('/strategy');
    cy.get('[data-testid="ai-intelligence-section"]', { timeout: 10000 }).should('be.visible');
  });

  it('should persist Micro-Scalp preset after save and reload', () => {
    // Navigate to AI Intelligence settings
    cy.get('[data-testid="ai-override-switch"]').click();
    cy.get('[data-testid="ai-preset-select"]').should('be.visible');

    // Apply Micro-Scalp preset
    cy.get('[data-testid="ai-preset-select"]').click();
    cy.get('[data-value="microScalp"]').click();

    // Verify preset values are applied
    cy.get('[data-testid="fusion-enabled-switch"]').should('be.checked');
    cy.get('[data-testid="enter-threshold-label"]').should('contain', '0.65');
    cy.get('[data-testid="exit-threshold-label"]').should('contain', '0.35'); 
    cy.get('[data-testid="spread-threshold-label"]').should('contain', '12');
    cy.get('[data-testid="min-depth-ratio-label"]').should('contain', '3');

    // Save the configuration
    cy.get('[data-testid="save-strategy-button"]').click();
    cy.get('[data-testid="save-success-message"]', { timeout: 5000 }).should('be.visible');

    // Hard reload the page
    cy.reload();
    cy.get('[data-testid="ai-intelligence-section"]', { timeout: 10000 }).should('be.visible');

    // Navigate back to AI Intelligence settings
    cy.get('[data-testid="ai-override-switch"]').should('be.checked');
    
    // Verify preset is still selected
    cy.get('[data-testid="ai-preset-select"]').should('contain', 'Micro-Scalp');

    // Verify values are still correct
    cy.get('[data-testid="fusion-enabled-switch"]').should('be.checked');
    cy.get('[data-testid="enter-threshold-label"]').should('contain', '0.65');
    cy.get('[data-testid="exit-threshold-label"]').should('contain', '0.35');
    cy.get('[data-testid="spread-threshold-label"]').should('contain', '12');
    cy.get('[data-testid="min-depth-ratio-label"]').should('contain', '3');
  });

  it('should show Custom when preset values are modified', () => {
    // Navigate to AI Intelligence settings and apply preset
    cy.get('[data-testid="ai-override-switch"]').click();
    cy.get('[data-testid="ai-preset-select"]').click();
    cy.get('[data-value="microScalp"]').click();

    // Verify preset is applied
    cy.get('[data-testid="ai-preset-select"]').should('contain', 'Micro-Scalp');

    // Modify enter threshold beyond epsilon
    cy.get('[data-testid="enter-threshold-slider"]').as('enterSlider');
    cy.get('@enterSlider').trigger('keydown', { keyCode: 39 }); // Arrow right to increase value

    // Verify preset selector shows Custom
    cy.get('[data-testid="ai-preset-select"]').should('contain', 'Custom');
  });

  it('should switch between presets correctly', () => {
    // Navigate to AI Intelligence settings
    cy.get('[data-testid="ai-override-switch"]').click();

    // Apply Micro-Scalp preset
    cy.get('[data-testid="ai-preset-select"]').click();
    cy.get('[data-value="microScalp"]').click();
    cy.get('[data-testid="enter-threshold-label"]').should('contain', '0.65');

    // Save and verify
    cy.get('[data-testid="save-strategy-button"]').click();
    cy.get('[data-testid="save-success-message"]', { timeout: 5000 }).should('be.visible');

    // Switch to Aggressive preset
    cy.get('[data-testid="ai-preset-select"]').click();
    cy.get('[data-value="aggressive"]').click();
    cy.get('[data-testid="enter-threshold-label"]').should('contain', '0.55');

    // Save and verify
    cy.get('[data-testid="save-strategy-button"]').click();
    cy.get('[data-testid="save-success-message"]', { timeout: 5000 }).should('be.visible');

    // Reload and verify Aggressive is selected
    cy.reload();
    cy.get('[data-testid="ai-intelligence-section"]', { timeout: 10000 }).should('be.visible');
    cy.get('[data-testid="ai-preset-select"]').should('contain', 'Aggressive');

    // Switch back to Micro-Scalp
    cy.get('[data-testid="ai-preset-select"]').click();
    cy.get('[data-value="microScalp"]').click();
    cy.get('[data-testid="enter-threshold-label"]').should('contain', '0.65');

    // Save and reload to verify persistence
    cy.get('[data-testid="save-strategy-button"]').click();
    cy.get('[data-testid="save-success-message"]', { timeout: 5000 }).should('be.visible');
    cy.reload();
    cy.get('[data-testid="ai-intelligence-section"]', { timeout: 10000 }).should('be.visible');
    cy.get('[data-testid="ai-preset-select"]').should('contain', 'Micro-Scalp');
  });

  it('should maintain AI override toggle state with preset selection', () => {
    // Start with AI override disabled
    cy.get('[data-testid="ai-override-switch"]').should('not.be.checked');

    // Enable AI override
    cy.get('[data-testid="ai-override-switch"]').click();
    cy.get('[data-testid="ai-preset-select"]').should('be.visible');

    // Apply preset
    cy.get('[data-testid="ai-preset-select"]').click();
    cy.get('[data-value="microScalp"]').click();

    // Save configuration
    cy.get('[data-testid="save-strategy-button"]').click();
    cy.get('[data-testid="save-success-message"]', { timeout: 5000 }).should('be.visible');

    // Reload page
    cy.reload();
    cy.get('[data-testid="ai-intelligence-section"]', { timeout: 10000 }).should('be.visible');

    // Verify AI override is still enabled and preset is selected
    cy.get('[data-testid="ai-override-switch"]').should('be.checked');
    cy.get('[data-testid="ai-preset-select"]').should('contain', 'Micro-Scalp');

    // Toggle AI override off and back on
    cy.get('[data-testid="ai-override-switch"]').click();
    cy.get('[data-testid="ai-preset-select"]').should('not.be.visible');
    
    cy.get('[data-testid="ai-override-switch"]').click();
    cy.get('[data-testid="ai-preset-select"]').should('be.visible');
    cy.get('[data-testid="ai-preset-select"]').should('contain', 'Micro-Scalp');
  });
});