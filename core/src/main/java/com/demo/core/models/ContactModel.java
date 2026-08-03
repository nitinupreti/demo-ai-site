/*
 *  Copyright 2026 Adobe Systems Incorporated
 */
package com.demo.core.models;

import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.Default;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

@Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class ContactModel {

    @ValueMapValue @Default(values = "Say Hi!") private String sayHiLabel;
    @ValueMapValue @Default(values = "Get a Quote") private String getQuoteLabel;
    @ValueMapValue @Default(values = "Name") private String nameLabel;
    @ValueMapValue @Default(values = "Email*") private String emailLabel;
    @ValueMapValue @Default(values = "Message*") private String messageLabel;
    @ValueMapValue @Default(values = "Send Message") private String submitLabel;
    @ValueMapValue @Default(values = "#") private String submitAction;
    @ValueMapValue private String illustration;
    @ValueMapValue @Default(values = "") private String illustrationAlt;

    public String getSayHiLabel() { return sayHiLabel; }
    public String getGetQuoteLabel() { return getQuoteLabel; }
    public String getNameLabel() { return nameLabel; }
    public String getEmailLabel() { return emailLabel; }
    public String getMessageLabel() { return messageLabel; }
    public String getSubmitLabel() { return submitLabel; }
    public String getSubmitAction() { return submitAction; }
    public String getIllustration() { return illustration; }
    public String getIllustrationAlt() { return illustrationAlt; }
}
