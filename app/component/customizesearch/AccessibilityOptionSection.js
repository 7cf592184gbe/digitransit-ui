import PropTypes from 'prop-types';
import React from 'react';
import { FormattedMessage } from 'react-intl';
import Toggle from '../Toggle';
import { saveRoutingSettings } from '../../action/SearchSettingsActions';
import Icon from '../Icon';

const AccessibilityOptionSection = ({ currentSettings }, { executeAction }) => (
  <fieldset>
    <legend className="accessibility-header settings-header">
      <FormattedMessage id="accessibility" defaultMessage="Accessibility" />
    </legend>
    <div className="mode-option-container toggle-container accessibility-container">
      {/* eslint jsx-a11y/label-has-associated-control: ["error", { assert: "either" } ] */}
      <label htmlFor="settings-toggle-accessibility" className="toggle-label">
        <Icon
          className="wheelchair-icon"
          img="icon-icon_wheelchair"
          height={2}
          width={2}
        />
        <FormattedMessage
          id="accessibility-limited"
          defaultMessage="Wheelchair"
        />
      </label>
      <Toggle
        id="settings-toggle-accessibility"
        toggled={!!currentSettings.usingWheelchair}
        title="accessibility"
        onToggle={e => {
          executeAction(saveRoutingSettings, {
            usingWheelchair: e.target.checked ? 1 : 0,
          });
        }}
      />
    </div>
  </fieldset>
);

AccessibilityOptionSection.propTypes = {
  currentSettings: PropTypes.object.isRequired,
};

AccessibilityOptionSection.contextTypes = {
  executeAction: PropTypes.func.isRequired,
};

export default AccessibilityOptionSection;
