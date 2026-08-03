/*
 *  Copyright 2026 Adobe Systems Incorporated
 */
package com.demo.core.models;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import javax.annotation.PostConstruct;

import org.apache.commons.lang3.StringUtils;
import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.Default;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ChildResource;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

@Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class FooterModel {

    @ValueMapValue @Default(values = "Positivus") private String logoText;
    @ValueMapValue @Default(values = "Contact us:") private String contactHeading;
    @ValueMapValue private String email;
    @ValueMapValue private String phone;
    @ValueMapValue private String address;
    @ValueMapValue @Default(values = "Email") private String subscribePlaceholder;
    @ValueMapValue @Default(values = "Subscribe to news") private String subscribeButton;
    @ValueMapValue @Default(values = "") private String copyright;
    @ValueMapValue @Default(values = "") private String privacyText;
    @ValueMapValue @Default(values = "#") private String privacyLink;

    @ChildResource private List<FooterLink> nav;
    @ChildResource private List<FooterLink> social;

    @PostConstruct
    protected void init() {
        if (nav == null) nav = new ArrayList<>();
        if (social == null) social = new ArrayList<>();
        nav.removeIf(n -> n == null || !n.isHasContent());
        social.removeIf(s -> s == null || !s.isHasContent());
    }

    public String getLogoText() { return logoText; }
    public String getContactHeading() { return contactHeading; }
    public String getEmail() { return email; }
    public String getPhone() { return phone; }
    public String getAddress() { return address; }
    public String getSubscribePlaceholder() { return subscribePlaceholder; }
    public String getSubscribeButton() { return subscribeButton; }
    public String getCopyright() { return copyright; }
    public String getPrivacyText() { return privacyText; }
    public String getPrivacyLink() { return privacyLink; }
    public List<FooterLink> getNav() { return Collections.unmodifiableList(nav); }
    public List<FooterLink> getSocial() { return Collections.unmodifiableList(social); }

    @Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
    public static class FooterLink {
        @ValueMapValue private String label;
        @ValueMapValue @Default(values = "#") private String link;

        public String getLabel() { return label; }
        public String getLink() { return link; }

        public boolean isHasContent() {
            return StringUtils.isNotBlank(label);
        }
    }
}
